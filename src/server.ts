import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { logger } from "./utils/logging.js";

// Cargamos las variables del .env.
// quiet: true evita que dotenv escriba mensajes en stdout (rompería MCP).
dotenv.config({ quiet: true });

const server = new McpServer({
  name: "github-mcp-server",
  version: "1.0.0",
});

// Tool de prueba (la reemplazaremos por las tools de GitHub en el Hito 5)
server.registerTool(
  "saludar",
  {
    title: "Saludar",
    description:
      "Devuelve un saludo personalizado. Úsala solo para comprobar que el servidor MCP responde.",
    inputSchema: {
      nombre: z.string().describe("Nombre de la persona a saludar"),
    },
  },
  async ({ nombre }) => {
    logger.info("Tool ejecutada", { tool: "saludar" });
    return {
      content: [
        { type: "text", text: `¡Hola ${nombre}! El servidor MCP está funcionando.` },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Servidor MCP iniciado y escuchando por stdio");
}

main().catch((error) => {
  logger.error("Error fatal al iniciar el servidor", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});