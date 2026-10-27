// =====================================================
// Entry point del MCP Server de GitHub.
// - Carga variables de entorno
// - Registra las tools
// - Se comunica con el host (Antigravity / Inspector) por stdio
// =====================================================

import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "./utils/logging.js";

// quiet: true evita que dotenv escriba en stdout (rompería el protocolo MCP).
dotenv.config({ quiet: true });

const server = new McpServer({
  name: "github-mcp-server",
  version: "1.0.0",
});

registerAllTools(server);

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    // No cortamos el servidor: las tools devolverán un mensaje claro al LLM.
    logger.warn(
      "GITHUB_TOKEN no está configurado. Las tools devolverán un error de autenticación hasta que se configure."
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Servidor MCP de GitHub iniciado y escuchando por stdio");
}

main().catch((error) => {
  logger.error("Error fatal al iniciar el servidor", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});