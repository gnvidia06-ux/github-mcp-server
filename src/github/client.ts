// =====================================================
// Configuración del cliente de GitHub (Octokit).
// Separado de operations.ts para poder mockearlo en los tests.
// =====================================================

import { Octokit } from "@octokit/rest";
import { AuthenticationError } from "../errors/index.js";

let cachedClient: Octokit | null = null;

/** Lee el token desde las variables de entorno (nunca hardcodeado). */
export function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new AuthenticationError(
      "No se encontró GITHUB_TOKEN. Configurá la variable de entorno con tu Personal Access Token de GitHub (ver la sección de configuración del README)."
    );
  }
  return token;
}

/** Devuelve una única instancia de Octokit (se crea la primera vez). */
export function getOctokit(): Octokit {
  if (!cachedClient) {
    cachedClient = new Octokit({
      auth: getGitHubToken(),
      userAgent: "github-mcp-server/1.0.0",
    });
  }
  return cachedClient;
}

/** Solo para tests: fuerza a crear un cliente nuevo. */
export function resetOctokit(): void {
  cachedClient = null;
}