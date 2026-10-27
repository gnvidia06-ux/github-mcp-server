import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCommitShape, createCommitSchema } from "../schemas/index.js";
import { createCommit } from "../github/operations.js";
import { executeTool } from "./helpers.js";

export function registerCreateCommit(server: McpServer): void {
  server.registerTool(
    "create_commit",
    {
      title: "Crear commit (agregar o modificar archivo)",
      description:
        "Hace un commit en un repositorio de GitHub creando un archivo nuevo o reemplazando el contenido de uno existente. " +
        "Usala cuando el usuario pida agregar, escribir, actualizar o subir un archivo (por ejemplo un README o un script) a un repo. " +
        "El contenido enviado reemplaza al archivo completo. Si no se indica branch, usa la principal.",
      inputSchema: createCommitShape,
    },
    async (args) =>
      executeTool("create_commit", createCommitSchema, args, async (input) => {
        const result = await createCommit(input);
        return {
          summary: `Archivo "${result.path}" ${
            result.action === "created" ? "creado" : "actualizado"
          } con el commit ${result.commitSha.slice(0, 7)}.${
            result.commitUrl ? ` Link: ${result.commitUrl}` : ""
          }`,
          data: result,
        };
      })
  );
}