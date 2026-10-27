// =====================================================
// Tests de transformación de errores, reintentos,
// logging seguro y lectura del token.
// =====================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toAppError,
  toToolErrorResult,
  AppError,
  AuthenticationError,
  GitHubAPIError,
  NetworkError,
  ValidationError,
} from "../src/errors/index.js";
import { withRetry } from "../src/utils/retry.js";
import { redact } from "../src/utils/logging.js";
import { getGitHubToken } from "../src/github/client.js";

function httpError(
  status: number,
  message = "error",
  headers: Record<string, string> = {},
  data: unknown = {}
) {
  return Object.assign(new Error(message), { status, response: { headers, data } });
}

beforeEach(() => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toAppError: errores HTTP a lenguaje natural", () => {
  it("404 con repo devuelve el mensaje exacto pedido por la consigna", () => {
    const error = toAppError(httpError(404), { owner: "agus", repo: "demo" });
    expect(error).toBeInstanceOf(GitHubAPIError);
    expect(error.message).toBe(
      "El repositorio agus/demo no fue encontrado. Verifica el nombre e intenta de nuevo."
    );
  });

  it("404 con número de issue menciona el issue", () => {
    const error = toAppError(httpError(404), { owner: "agus", repo: "demo", issueNumber: 9 });
    expect(error.message).toContain("El issue #9 no existe");
  });

  it("401 se convierte en AuthenticationError", () => {
    const error = toAppError(httpError(401, "Bad credentials"));
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toContain("GITHUB_TOKEN");
  });

  it("403 sin rate limit indica problema de permisos/scopes", () => {
    const error = toAppError(httpError(403, "Forbidden"), { repo: "demo" });
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toContain("scopes");
  });

  it("403 con x-ratelimit-remaining=0 es rate limit y es reintentable", () => {
    const error = toAppError(httpError(403, "x", { "x-ratelimit-remaining": "0" }));
    expect(error).toBeInstanceOf(GitHubAPIError);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("límite de solicitudes");
  });

  it("422 'already exists' explica que el repo ya existe", () => {
    const error = toAppError(
      httpError(422, "Validation Failed", {}, { errors: [{ message: "name already exists on this account" }] }),
      { repo: "demo" }
    );
    expect(error.message).toContain("Ya existe un repositorio");
  });

  it("500 indica problema temporal de GitHub y es reintentable", () => {
    const error = toAppError(httpError(503));
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("problemas temporales");
  });

  it("un fallo de red se convierte en NetworkError", () => {
    const error = toAppError(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }));
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toContain("conexión a internet");
  });

  it("si ya es un AppError lo devuelve sin cambios", () => {
    const original = new ValidationError("dato inválido");
    expect(toAppError(original)).toBe(original);
  });
});

describe("toToolErrorResult", () => {
  it("devuelve el formato MCP con isError: true y el mensaje", () => {
    const result = toToolErrorResult(new ValidationError("Falta el título"));
    expect(result).toEqual({
      content: [{ type: "text", text: "Falta el título" }],
      isError: true,
    });
  });
});

describe("withRetry (exponential backoff)", () => {
  it("reintenta un error de red y termina con éxito, esperando cada vez más", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue("ok");

    const result = await withRetry(operation, { sleep });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    const [firstDelay] = sleep.mock.calls[0];
    const [secondDelay] = sleep.mock.calls[1];
    expect(firstDelay).toBeGreaterThanOrEqual(500);
    expect(secondDelay).toBeGreaterThanOrEqual(1000);
    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it("NO reintenta errores que no se arreglan reintentando (404)", async () => {
    const sleep = vi.fn();
    const operation = vi.fn().mockRejectedValue(httpError(404));

    await expect(withRetry(operation, { sleep })).rejects.toBeDefined();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("se rinde después de la cantidad máxima de reintentos", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new NetworkError());

    await expect(withRetry(operation, { retries: 2, sleep })).rejects.toBeInstanceOf(AppError);
    expect(operation).toHaveBeenCalledTimes(3); // 1 intento + 2 reintentos
  });
});

describe("Seguridad: logs y token", () => {
  it("redact oculta tokens de GitHub y campos sensibles", () => {
    const result = redact({
      mensaje: "usando ghp_ABC123secreto456",
      token: "cualquier-cosa",
      repo: "demo",
    }) as Record<string, string>;

    expect(result.mensaje).toBe("usando [REDACTED]");
    expect(result.token).toBe("[REDACTED]");
    expect(result.repo).toBe("demo");
  });

  it("getGitHubToken lanza AuthenticationError si falta GITHUB_TOKEN", () => {
    const original = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      expect(() => getGitHubToken()).toThrow(AuthenticationError);
    } finally {
      if (original !== undefined) process.env.GITHUB_TOKEN = original;
    }
  });
});