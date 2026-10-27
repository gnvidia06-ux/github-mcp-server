// Registra todas las tools en el servidor MCP.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateRepository } from "./create-repository.js";
import { registerCreateIssue } from "./create-issue.js";
import { registerListRepositories } from "./list-repositories.js";
import { registerCreateCommit } from "./create-commit.js";
import { registerListIssues } from "./list-issues.js";
import { registerExtraTools } from "./extra-tools.js";

export function registerAllTools(server: McpServer): void {
  // Obligatorias
  registerCreateRepository(server);
  registerCreateIssue(server);
  registerListRepositories(server);
  registerCreateCommit(server);
  registerListIssues(server);

  // Extra credit
  registerExtraTools(server);
}