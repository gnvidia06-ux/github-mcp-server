// =====================================================
// Operaciones contra la API de GitHub.
// Cada función:
//   1) obtiene el cliente de Octokit,
//   2) ejecuta la llamada con reintentos (withRetry),
//   3) devuelve solo los datos útiles,
//   4) si falla, traduce el error a lenguaje natural (toAppError).
// =====================================================

import type { Octokit } from "@octokit/rest";
import { getOctokit } from "./client.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logging.js";
import {
  GitHubAPIError,
  ValidationError,
  toAppError,
  type ErrorContext,
} from "../errors/index.js";
import type {
  CreateRepositoryInput,
  CreateIssueInput,
  ListRepositoriesInput,
  CreateCommitInput,
  ListIssuesInput,
  CreateBranchInput,
  CloseIssueInput,
  AddCommentInput,
  ListCommitsInput,
} from "../schemas/index.js";
import type {
  RepositorySummary,
  IssueSummary,
  CommitResult,
  CommitSummary,
  BranchResult,
  CommentResult,
  HealthStatus,
} from "../types.js";

// -----------------------------------------------------
// Helpers internos
// -----------------------------------------------------

let cachedLogin: string | null = null;

/** Usuario dueño del token (se consulta una sola vez). */
async function getAuthenticatedLogin(octokit: Octokit): Promise<string> {
  if (cachedLogin) return cachedLogin;
  const { data } = await octokit.rest.users.getAuthenticated();
  cachedLogin = data.login;
  return cachedLogin;
}

/** Si no se indicó owner, se usa el usuario autenticado. */
async function resolveOwner(octokit: Octokit, owner?: string): Promise<string> {
  return owner ?? (await getAuthenticatedLogin(octokit));
}

/** Detecta si un error "crudo" de Octokit tiene cierto status HTTP. */
function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: number }).status === status
  );
}

/**
 * Envoltorio común: reintentos + logging + traducción de errores.
 */
async function run<T>(
  action: string,
  context: ErrorContext,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await withRetry(fn);
    logger.info("Operación completada", { action, durationMs: Date.now() - start });
    return result;
  } catch (error) {
    const appError = toAppError(error, context);
    logger.error("Operación fallida", {
      action,
      code: appError.code,
      message: appError.message,
    });
    throw appError;
  }
}

// -----------------------------------------------------
// Caché en memoria para list_repositories (extra credit)
// -----------------------------------------------------

const REPO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const repoCache = new Map<string, { expiresAt: number; data: RepositorySummary[] }>();

/** Solo para tests: limpia cachés internas. */
export function resetOperationsCache(): void {
  cachedLogin = null;
  repoCache.clear();
}

// =====================================================
// 1) create_repository
// =====================================================
export async function createRepository(
  input: CreateRepositoryInput
): Promise<RepositorySummary> {
  return run("create_repository", { repo: input.name }, async () => {
    const octokit = getOctokit();
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name: input.name,
      description: input.description,
      private: input.private,
      auto_init: input.autoInit,
    });

    repoCache.clear(); // la lista de repos cambió

    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description ?? null,
      private: data.private,
      url: data.html_url,
      defaultBranch: data.default_branch,
      updatedAt: data.updated_at ?? null,
    };
  });
}

// =====================================================
// 2) create_issue
// =====================================================
export async function createIssue(input: CreateIssueInput): Promise<IssueSummary> {
  return run("create_issue", { owner: input.owner, repo: input.repo }, async () => {
    const octokit = getOctokit();
    const owner = await resolveOwner(octokit, input.owner);

    const { data } = await octokit.rest.issues.create({
      owner,
      repo: input.repo,
      title: input.title,
      body: input.body,
      labels: input.labels,
    });

    return mapIssue(data);
  });
}

// =====================================================
// 3) list_repositories (con caché)
// =====================================================
export async function listRepositories(
  input: ListRepositoriesInput
): Promise<RepositorySummary[]> {
  const cacheKey = JSON.stringify(input);
  const cached = repoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug("list_repositories servido desde caché", { cacheKey });
    return cached.data;
  }

  const repos = await run("list_repositories", {}, async () => {
    const octokit = getOctokit();
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      visibility: input.visibility,
      sort: input.sort,
      per_page: input.perPage,
    });

    return data.map(
      (repo): RepositorySummary => ({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description ?? null,
        private: repo.private,
        url: repo.html_url,
        defaultBranch: repo.default_branch,
        updatedAt: repo.updated_at ?? null,
      })
    );
  });

  repoCache.set(cacheKey, { expiresAt: Date.now() + REPO_CACHE_TTL_MS, data: repos });
  return repos;
}

// =====================================================
// 4) create_commit (crear o actualizar un archivo)
// =====================================================
export async function createCommit(input: CreateCommitInput): Promise<CommitResult> {
  return run("create_commit", { owner: input.owner, repo: input.repo }, async () => {
    const octokit = getOctokit();
    const owner = await resolveOwner(octokit, input.owner);

    // Si el archivo ya existe, GitHub necesita su "sha" para reemplazarlo.
    let existingSha: string | undefined;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo: input.repo,
        path: input.path,
        ref: input.branch,
      });
      if (Array.isArray(data)) {
        throw new ValidationError(
          `La ruta "${input.path}" es una carpeta, no un archivo. Indicá la ruta completa del archivo (ej: "${input.path}/notas.md").`
        );
      }
      if ("sha" in data) existingSha = data.sha;
    } catch (error) {
      // 404 = el archivo todavía no existe: lo vamos a crear.
      if (!hasStatus(error, 404)) throw error;
    }

    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo: input.repo,
      path: input.path,
      message: input.message,
      content: Buffer.from(input.content, "utf8").toString("base64"),
      sha: existingSha,
      branch: input.branch,
    });

    return {
      action: existingSha ? "updated" : "created",
      path: input.path,
      branch: input.branch ?? null,
      commitSha: data.commit.sha ?? "",
      commitUrl: data.commit.html_url ?? null,
      fileUrl: data.content?.html_url ?? null,
    };
  });
}

// =====================================================
// 5) list_issues
// =====================================================
export async function listIssues(input: ListIssuesInput): Promise<IssueSummary[]> {
  return run("list_issues", { owner: input.owner, repo: input.repo }, async () => {
    const octokit = getOctokit();
    const owner = await resolveOwner(octokit, input.owner);

    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo: input.repo,
      state: input.state,
      per_page: input.perPage,
    });

    // La API de issues también devuelve pull requests: los filtramos.
    return data.filter((item) => !item.pull_request).map(mapIssue);
  });
}

// =====================================================
// EXTRA CREDIT
// =====================================================

// 6) create_branch
export async function createBranch(input: CreateBranchInput): Promise<BranchResult> {
  return run("create_branch", { owner: input.owner, repo: input.repo }, async () => {
    const octokit = getOctokit();
    const owner = await resolveOwner(octokit, input.owner);

    // Branch base: la indicada o la principal del repo.
    const baseBranch =
      input.fromBranch ??
      (await octokit.rest.repos.get({ owner, repo: input.repo })).data.default_branch;

    let baseSha: string;
    try {
      const { data } = await octokit.rest.git.getRef({
        owner,
        repo: input.repo,
        ref: `heads/${baseBranch}`,
      });
      baseSha = data.object.sha;
    } catch (error) {
      if (hasStatus(error, 404)) {
        throw new GitHubAPIError(
          `La branch base "${baseBranch}" no existe en ${owner}/${input.repo}. Verifica el nombre e intenta de nuevo.`,
          404
        );
      }
      throw error;
    }

    try {
      const { data } = await octokit.rest.git.createRef({
        owner,
        repo: input.repo,
        ref: `refs/heads/${input.branch}`,
        sha: baseSha,
      });
      return {
        name: input.branch,
        fromBranch: baseBranch,
        sha: data.object.sha,
        url: `https://github.com/${owner}/${input.repo}/tree/${input.branch}`,
      };
    } catch (error) {
      if (hasStatus(error, 422)) {
        throw new GitHubAPIError(
          `La branch "${input.branch}" ya existe en ${owner}/${input.repo}. Elegí otro nombre.`,
          422
        );
      }
      throw error;
    }
  });
}

// 7) close_issue
export async function closeIssue(input: CloseIssueInput): Promise<IssueSummary> {
  return run(
    "close_issue",
    { owner: input.owner, repo: input.repo, issueNumber: input.issueNumber },
    async () => {
      const octokit = getOctokit();
      const owner = await resolveOwner(octokit, input.owner);

      if (input.comment) {
        await octokit.rest.issues.createComment({
          owner,
          repo: input.repo,
          issue_number: input.issueNumber,
          body: input.comment,
        });
      }

      const { data } = await octokit.rest.issues.update({
        owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        state: "closed",
      });

      return mapIssue(data);
    }
  );
}

// 8) add_comment_to_issue
export async function addCommentToIssue(input: AddCommentInput): Promise<CommentResult> {
  return run(
    "add_comment_to_issue",
    { owner: input.owner, repo: input.repo, issueNumber: input.issueNumber },
    async () => {
      const octokit = getOctokit();
      const owner = await resolveOwner(octokit, input.owner);

      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        body: input.body,
      });

      return { id: data.id, url: data.html_url, issueNumber: input.issueNumber };
    }
  );
}

// 9) list_commits
export async function listCommits(input: ListCommitsInput): Promise<CommitSummary[]> {
  return run("list_commits", { owner: input.owner, repo: input.repo }, async () => {
    const octokit = getOctokit();
    const owner = await resolveOwner(octokit, input.owner);

    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo: input.repo,
      sha: input.branch,
      per_page: input.perPage,
    });

    return data.map(
      (c): CommitSummary => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0] ?? "",
        author: c.commit.author?.name ?? c.author?.login ?? null,
        date: c.commit.author?.date ?? null,
        url: c.html_url,
      })
    );
  });
}

// Health check: verifica token, scopes y rate limit (extra credit)
const REQUIRED_SCOPES = ["repo", "user", "admin:org"];

export async function healthCheck(): Promise<HealthStatus> {
  return run("health_check", {}, async () => {
    const octokit = getOctokit();

    const userResponse = await octokit.rest.users.getAuthenticated();
    const scopesHeader = String(userResponse.headers["x-oauth-scopes"] ?? "");
    const scopes = scopesHeader
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const { data: rate } = await octokit.rest.rateLimit.get();

    return {
      ok: true,
      login: userResponse.data.login,
      scopes,
      missingScopes: REQUIRED_SCOPES.filter((s) => !scopes.includes(s)),
      rateLimit: {
        remaining: rate.resources.core.remaining,
        limit: rate.resources.core.limit,
        resetAt: new Date(rate.resources.core.reset * 1000).toISOString(),
      },
    };
  });
}

// -----------------------------------------------------
// Mapeo común de issues
// -----------------------------------------------------
function mapIssue(issue: {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user?: { login: string } | null;
  labels: Array<string | { name?: string | null }>;
  comments: number;
  created_at: string;
}): IssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    author: issue.user?.login ?? null,
    labels: issue.labels
      .map((l) => (typeof l === "string" ? l : l.name ?? ""))
      .filter(Boolean),
    comments: issue.comments,
    createdAt: issue.created_at,
  };
}