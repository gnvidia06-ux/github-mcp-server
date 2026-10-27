import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRepositoryShape, createRepositorySchema } from "../schemas/index.js";
import { createRepository } from "../github/operations.js";
import { executeTool } from "./helpers.js";

export function registerCreateRepository(server: McpServer): void {
  server.registerTool(
    "create_repository",
    {
      title: "Crear repositorio",
      description:
        "Crea un repositorio NUEVO en la cuenta personal de GitHub del usuario autenticado. " +
        "Usala cuando el usuario pida crear, iniciar o armar un repo o proyecto nuevo. " +
        "Por defecto es público y se crea con un README inicial. " +
        "No la uses para ver repos existentes (para eso está list_repositories).",
      inputSchema: createRepositoryShape,
    },
    async (args) =>
      executeTool("create_repository", createRepositorySchema, args, async (input) => {
        const repo = await createRepository(input);
        return {
          summary: `Repositorio ${repo.fullName} creado como ${
            repo.private ? "privado" : "público"
          }. Link: ${repo.url}`,
          data: repo,
        };
      })
  );
}