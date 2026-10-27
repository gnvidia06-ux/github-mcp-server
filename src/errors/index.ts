// =====================================================
// Errores personalizados del MCP server
// Objetivo: transformar errores técnicos (HTTP, red, etc.)
// en mensajes en lenguaje natural que el LLM pueda comunicar.
// =====================================================

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "GITHUB_API_ERROR"
  | "NETWORK_ERROR";

/** Clase base: todos nuestros errores heredan de acá. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Indica si tiene sentido reintentar la operación. */
  readonly retryable: boolean;

  constructor(message: string, code: ErrorCode, retryable = false) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Los datos que mandó el usuario/LLM no cumplen las reglas. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

/** Token inválido, vencido o sin permisos suficientes. */
export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message, "AUTHENTICATION_ERROR");
  }
}

/** GitHub respondió con un error (404, 422, rate limit, 5xx...). */
export class GitHubAPIError extends AppError {
  readonly status: number;
  /** Cuánto pide GitHub que esperemos antes de reintentar (si lo indica). */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    options: { retryable?: boolean; retryAfterMs?: number } = {}
  ) {
    super(message, "GITHUB_API_ERROR", options.retryable ?? false);
    this.status = status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** No se pudo llegar a GitHub (sin internet, DNS, timeout...). */
export class NetworkError extends AppError {
  constructor(
    message = "No se pudo conectar con GitHub. Verificá tu conexión a internet e intentá de nuevo."
  ) {
    super(message, "NETWORK_ERROR", true);
  }
}

// -----------------------------------------------------
// Traductor: error técnico -> AppError con mensaje claro
// -----------------------------------------------------

/** Datos opcionales para que el mensaje sea más específico. */
export interface ErrorContext {
  owner?: string;
  repo?: string;
  issueNumber?: number;
}

/** Forma "aproximada" de los errores que lanza Octokit / fetch. */
interface HttpLikeError {
  status?: number;
  message?: string;
  code?: string;
  cause?: unknown;
  response?: {
    headers?: Record<string, string | number | undefined>;
    data?: unknown;
  };
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

function isNetworkFailure(err: HttpLikeError): boolean {
  const causeCode = (err.cause as { code?: string } | undefined)?.code;
  if (err.code && NETWORK_CODES.has(err.code)) return true;
  if (causeCode && NETWORK_CODES.has(causeCode)) return true;
  return (err.message ?? "").toLowerCase().includes("fetch failed");
}

function isRateLimited(err: HttpLikeError): boolean {
  if (err.status === 429) return true;
  const remaining = err.response?.headers?.["x-ratelimit-remaining"];
  return (
    err.status === 403 &&
    (String(remaining) === "0" ||
      (err.message ?? "").toLowerCase().includes("rate limit"))
  );
}

function getRetryAfterMs(err: HttpLikeError): number | undefined {
  const headers = err.response?.headers ?? {};

  const retryAfter = headers["retry-after"];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }

  const reset = headers["x-ratelimit-reset"];
  if (reset !== undefined) {
    const ms = Number(reset) * 1000 - Date.now();
    if (!Number.isNaN(ms)) return Math.max(ms, 0);
  }

  return undefined;
}

function extractDetail(err: HttpLikeError): string {
  const data = err.response?.data as
    | { message?: string; errors?: Array<{ message?: string }> }
    | undefined;
  return data?.errors?.[0]?.message ?? data?.message ?? err.message ?? "";
}

function describeRepo(ctx: ErrorContext): string | undefined {
  if (ctx.owner && ctx.repo) return `${ctx.owner}/${ctx.repo}`;
  return ctx.repo;
}

/**
 * Convierte cualquier error en un AppError con un mensaje en lenguaje natural.
 */
export function toAppError(error: unknown, context: ErrorContext = {}): AppError {
  // Si ya es uno de los nuestros, lo devolvemos tal cual.
  if (error instanceof AppError) return error;

  if (typeof error !== "object" || error === null) {
    return new GitHubAPIError(
      "Ocurrió un error inesperado. Intentá de nuevo en unos segundos.",
      0
    );
  }

  const err = error as HttpLikeError;
  const status = err.status;
  const repoLabel = describeRepo(context);

  // 1) Problemas de red
  if (isNetworkFailure(err)) return new NetworkError();

  // 2) Token inválido o vencido
  if (status === 401) {
    return new AuthenticationError(
      "El token de GitHub es inválido o expiró. Revisá la variable GITHUB_TOKEN y generá un token nuevo si hace falta."
    );
  }

  // 3) Límite de solicitudes (rate limit)
  if (status !== undefined && isRateLimited(err)) {
    const retryAfterMs = getRetryAfterMs(err);
    const minutes = retryAfterMs ? Math.ceil(retryAfterMs / 60000) : undefined;
    return new GitHubAPIError(
      `Se alcanzó el límite de solicitudes de GitHub. ${
        minutes
          ? `Intentá de nuevo en unos ${minutes} minuto(s).`
          : "Esperá unos minutos e intentá de nuevo."
      }`,
      status,
      { retryable: true, retryAfterMs }
    );
  }

  // 4) Sin permisos
  if (status === 403) {
    return new AuthenticationError(
      `No tenés permisos para realizar esta acción${
        repoLabel ? ` en ${repoLabel}` : ""
      }. Verificá que el token tenga los scopes repo, user y admin:org, y que tengas acceso de escritura.`
    );
  }

  // 5) No encontrado
  if (status === 404) {
    if (context.issueNumber !== undefined && repoLabel) {
      return new GitHubAPIError(
        `El issue #${context.issueNumber} no existe en el repositorio ${repoLabel}. Verifica el número e intenta de nuevo.`,
        404
      );
    }
    if (repoLabel) {
      return new GitHubAPIError(
        `El repositorio ${repoLabel} no fue encontrado. Verifica el nombre e intenta de nuevo.`,
        404
      );
    }
    return new GitHubAPIError(
      "El recurso solicitado no fue encontrado en GitHub. Verifica los datos e intenta de nuevo.",
      404
    );
  }

  // 6) Conflicto (ej: repo vacío al hacer un commit)
  if (status === 409) {
    return new GitHubAPIError(
      `Hay un conflicto en ${
        repoLabel ?? "el repositorio"
      }: puede estar vacío o el archivo cambió. Si el repo está vacío, crealo con un README inicial e intentá de nuevo.`,
      409
    );
  }

  // 7) Datos rechazados por GitHub
  if (status === 422) {
    const detail = extractDetail(err);
    if (detail.toLowerCase().includes("already exists")) {
      return new GitHubAPIError(
        `Ya existe un repositorio${
          repoLabel ? ` llamado ${repoLabel}` : ""
        } en tu cuenta. Elegí otro nombre.`,
        422
      );
    }
    return new GitHubAPIError(
      `GitHub rechazó los datos enviados${
        detail ? `: ${detail}` : ""
      }. Revisá los parámetros e intentá de nuevo.`,
      422
    );
  }

  // 8) Errores del lado de GitHub
  if (status !== undefined && status >= 500) {
    return new GitHubAPIError(
      "GitHub está teniendo problemas temporales. Intentá de nuevo en unos minutos.",
      status,
      { retryable: true }
    );
  }

  // 9) Cualquier otro caso
  return new GitHubAPIError(
    `Ocurrió un error inesperado al comunicarse con GitHub${
      status ? ` (código ${status})` : ""
    }. Intentá de nuevo.`,
    status ?? 0
  );
}

/** Formato de respuesta de error que entiende MCP (isError: true). */
export function toToolErrorResult(error: AppError) {
  return {
    content: [{ type: "text" as const, text: error.message }],
    isError: true,
  };
}