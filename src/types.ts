// =====================================================
// Tipos compartidos: la forma "limpia" de los datos que
// devolvemos al LLM (GitHub devuelve mucho más, filtramos).
// =====================================================

export interface RepositorySummary {
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  url: string;
  defaultBranch: string;
  updatedAt: string | null;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  labels: string[];
  comments: number;
  createdAt: string;
}

export interface CommitResult {
  action: "created" | "updated";
  path: string;
  branch: string | null;
  commitSha: string;
  commitUrl: string | null;
  fileUrl: string | null;
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string | null;
  date: string | null;
  url: string;
}

export interface BranchResult {
  name: string;
  fromBranch: string;
  sha: string;
  url: string;
}

export interface CommentResult {
  id: number;
  url: string;
  issueNumber: number;
}

export interface HealthStatus {
  ok: true;
  login: string;
  scopes: string[];
  missingScopes: string[];
  rateLimit: {
    remaining: number;
    limit: number;
    resetAt: string;
  };
}