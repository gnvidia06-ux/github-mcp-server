// =====================================================
// Tests de las operaciones de GitHub con Octokit MOCKEADO.
// Ninguno de estos tests llama a la API real de GitHub.
// =====================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";

// Reemplazamos el cliente real por uno "de juguete".
vi.mock("../src/github/client.js", () => ({
  getOctokit: vi.fn(),
}));

import { getOctokit } from "../src/github/client.js";
import {
  createRepository,
  listRepositories,
  createIssue,
  createCommit,
  listIssues,
  resetOperationsCache,
} from "../src/github/operations.js";
import { AuthenticationError, GitHubAPIError } from "../src/errors/index.js";

// ---------- GitHub de juguete ----------
const mock = {
  rest: {
    users: { getAuthenticated: vi.fn() },
    repos: {
      createForAuthenticatedUser: vi.fn(),
      listForAuthenticatedUser: vi.fn(),
      getContent: vi.fn(),
      createOrUpdateFileContents: vi.fn(),
    },
    issues: { create: vi.fn(), listForRepo: vi.fn() },
  },
};

/** Simula un error HTTP como los que lanza Octokit. */
function httpError(status: number, message = "error", headers: Record<string, string> = {}) {
  return Object.assign(new Error(message), { status, response: { headers, data: {} } });
}

/** Issue de ejemplo con la forma que devuelve GitHub. */
function fakeIssue(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    html_url: `https://github.com/agus/demo/issues/${number}`,
    user: { login: "agus" },
    labels: [{ name: "bug" }],
    comments: 0,
    created_at: "2026-10-27T00:00:00Z",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOperationsCache();
  vi.mocked(getOctokit).mockReturnValue(mock as unknown as Octokit);
  mock.rest.users.getAuthenticated.mockResolvedValue({ data: { login: "agus" } });
  // Silenciamos los logs durante los tests.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("createRepository", () => {
  it("envía los parámetros correctos y devuelve un resumen limpio", async () => {
    mock.rest.repos.createForAuthenticatedUser.mockResolvedValue({
      data: {
        name: "demo",
        full_name: "agus/demo",
        description: "Repo de prueba",
        private: false,
        html_url: "https://github.com/agus/demo",
        default_branch: "main",
        updated_at: "2026-10-27T00:00:00Z",
      },
    });

    const repo = await createRepository({
      name: "demo",
      description: "Repo de prueba",
      private: false,
      autoInit: true,
    });

    expect(mock.rest.repos.createForAuthenticatedUser).toHaveBeenCalledWith({
      name: "demo",
      description: "Repo de prueba",
      private: false,
      auto_init: true,
    });
    expect(repo.fullName).toBe("agus/demo");
    expect(repo.url).toBe("https://github.com/agus/demo");
  });
});

describe("listRepositories", () => {
  it("devuelve los repos y usa la caché en la segunda llamada", async () => {
    mock.rest.repos.listForAuthenticatedUser.mockResolvedValue({
      data: [
        {
          name: "demo",
          full_name: "agus/demo",
          description: null,
          private: true,
          html_url: "https://github.com/agus/demo",
          default_branch: "main",
          updated_at: null,
        },
      ],
    });

    const input = { visibility: "all" as const, sort: "updated" as const, perPage: 30 };
    const first = await listRepositories(input);
    const second = await listRepositories(input);

    expect(first).toHaveLength(1);
    expect(first[0].private).toBe(true);
    expect(second).toEqual(first);
    // La API se llamó UNA sola vez gracias a la caché.
    expect(mock.rest.repos.listForAuthenticatedUser).toHaveBeenCalledTimes(1);
  });
});

describe("createIssue", () => {
  it("usa el usuario autenticado como owner si no se indica", async () => {
    mock.rest.issues.create.mockResolvedValue({ data: fakeIssue(7) });

    const issue = await createIssue({ repo: "demo", title: "Issue 7" });

    expect(mock.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "agus", repo: "demo", title: "Issue 7" })
    );
    expect(issue.number).toBe(7);
    expect(issue.labels).toEqual(["bug"]);
  });

  it("si el repo no existe (404) devuelve un mensaje en lenguaje natural", async () => {
    mock.rest.issues.create.mockRejectedValue(httpError(404, "Not Found"));

    await expect(createIssue({ repo: "no-existe", title: "x" })).rejects.toThrow(
      "El repositorio no-existe no fue encontrado. Verifica el nombre e intenta de nuevo."
    );
  });
});

describe("createCommit", () => {
  const baseInput = { repo: "demo", path: "notas.md", content: "Hola", message: "docs: notas" };

  it("crea el archivo si no existe (getContent da 404)", async () => {
    mock.rest.repos.getContent.mockRejectedValue(httpError(404));
    mock.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: { commit: { sha: "abc1234567", html_url: "https://c" }, content: { html_url: "https://f" } },
    });

    const result = await createCommit(baseInput);

    expect(result.action).toBe("created");
    const params = mock.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(params.sha).toBeUndefined();
    // El contenido se envía en base64.
    expect(Buffer.from(params.content, "base64").toString("utf8")).toBe("Hola");
  });

  it("actualiza el archivo si ya existe, enviando su sha", async () => {
    mock.rest.repos.getContent.mockResolvedValue({ data: { type: "file", sha: "sha-viejo" } });
    mock.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: { commit: { sha: "def7654321", html_url: "https://c" }, content: { html_url: "https://f" } },
    });

    const result = await createCommit(baseInput);

    expect(result.action).toBe("updated");
    expect(mock.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "sha-viejo" })
    );
  });
});

describe("listIssues", () => {
  it("filtra los pull requests y devuelve solo issues", async () => {
    mock.rest.issues.listForRepo.mockResolvedValue({
      data: [fakeIssue(1), fakeIssue(2, { pull_request: { url: "x" } })],
    });

    const issues = await listIssues({ repo: "demo", state: "open", perPage: 30 });

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });
});

describe("Casos edge y errores", () => {
  it("credenciales inválidas (401) lanzan AuthenticationError", async () => {
    mock.rest.issues.listForRepo.mockRejectedValue(httpError(401, "Bad credentials"));

    const promise = listIssues({ owner: "agus", repo: "demo", state: "open", perPage: 30 });

    await expect(promise).rejects.toBeInstanceOf(AuthenticationError);
    await expect(promise).rejects.toThrow("token de GitHub es inválido");
  });

  it("rate limit con espera larga NO genera un loop de reintentos", async () => {
    const resetEnUnaHora = String(Math.floor(Date.now() / 1000) + 3600);
    mock.rest.issues.listForRepo.mockRejectedValue(
      httpError(403, "API rate limit exceeded", {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": resetEnUnaHora,
      })
    );

    const promise = listIssues({ owner: "agus", repo: "demo", state: "open", perPage: 30 });

    await expect(promise).rejects.toBeInstanceOf(GitHubAPIError);
    await expect(promise).rejects.toThrow("límite de solicitudes");
    // Se intentó una sola vez: no reintenta si GitHub pide esperar demasiado.
    expect(mock.rest.issues.listForRepo).toHaveBeenCalledTimes(1);
  });
});