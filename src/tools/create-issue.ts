import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createIssueShape, createIssueSchema } from "../schemas/index.js";
import { createIssue } from "../github/operations.js";
import { executeTool } from "./helpers.js";

export function registerCreateIssue(server: McpServer): void {
  server.registerTool(
    "create_issue",
    {
      title: "Crear issue",
      description:
        "Abre un issue NUEVO en un repositorio de GitHub, con título y descripción opcional. " +
        "Usala cuando el usuario quiera reportar un bug, registrar una tarea, pendiente o mejora en un repo. " +
        "Si no se indica owner, se usa la cuenta del usuario autenticado. " +
        "Para ver issues existentes usá list_issues; para comentar uno existente, add_comment_to_issue.",
      inputSchema: createIssueShape,
    },
    async (args) =>
      executeTool("create_issue", createIssueSchema, args, async (input) => {
        const issue = await createIssue(input);
        return {
          summary: `Issue #${issue.number} "${issue.title}" creado. Link: ${issue.url}`,
          data: issue,
        };
      })
  );
}