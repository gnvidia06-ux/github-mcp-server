import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listIssuesShape, listIssuesSchema } from "../schemas/index.js";
import { listIssues } from "../github/operations.js";
import { executeTool } from "./helpers.js";

export function registerListIssues(server: McpServer): void {
  server.registerTool(
    "list_issues",
    {
      title: "Listar issues",
      description:
        "Lista los issues de un repositorio específico de GitHub (por defecto solo los abiertos). " +
        "Usala cuando el usuario quiera ver pendientes, bugs o tareas de un repo, o necesite el número de un issue para cerrarlo o comentarlo. " +
        "No incluye pull requests.",
      inputSchema: listIssuesShape,
    },
    async (args) =>
      executeTool("list_issues", listIssuesSchema, args, async (input) => {
        const issues = await listIssues(input);
        const estado =
          input.state === "open" ? "abiertos" : input.state === "closed" ? "cerrados" : "";
        return {
          summary:
            issues.length === 0
              ? `El repositorio ${input.repo} no tiene issues ${estado}.`.replace("  ", " ")
              : `Se encontraron ${issues.length} issue(s) ${estado} en ${input.repo}.`.replace("  ", " "),
          data: issues,
        };
      })
  );
}