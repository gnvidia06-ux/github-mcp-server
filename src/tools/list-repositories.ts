import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listRepositoriesShape, listRepositoriesSchema } from "../schemas/index.js";
import { listRepositories } from "../github/operations.js";
import { executeTool } from "./helpers.js";

export function registerListRepositories(server: McpServer): void {
  server.registerTool(
    "list_repositories",
    {
      title: "Listar repositorios",
      description:
        "Lista los repositorios del usuario autenticado en GitHub (propios y de organizaciones a las que pertenece). " +
        "Usala cuando el usuario pregunte qué repos tiene, quiera buscar uno o necesite el nombre exacto de un repo antes de otra acción. " +
        "Permite filtrar por visibilidad y ordenar. Los resultados se guardan en caché 5 minutos.",
      inputSchema: listRepositoriesShape,
    },
    async (args) =>
      executeTool("list_repositories", listRepositoriesSchema, args, async (input) => {
        const repos = await listRepositories(input);
        return {
          summary:
            repos.length === 0
              ? "No se encontraron repositorios con esos filtros."
              : `Se encontraron ${repos.length} repositorio(s).`,
          data: repos,
        };
      })
  );
}