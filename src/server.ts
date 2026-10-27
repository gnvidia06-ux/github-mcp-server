import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. Creamos el servidor con un nombre y una versión.
const server = new McpServer({
  name: "github-mcp-server",
  version: "1.0.0",
});

// 2. Registramos una herramienta de prueba.
//    - "description" es el cartelito que lee la IA para decidir si usarla.
//    - "inputSchema" dice qué datos necesita (validado con Zod).
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
    return {
      content: [
        { type: "text", text: `¡Hola ${nombre}! El servidor MCP está funcionando.` },
      ],
    };
  }
);

// 3. Conectamos el servidor por stdio (entrada/salida estándar).
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // console.error y NO console.log: stdout está reservado para el protocolo MCP.
  console.error("Servidor MCP iniciado y escuchando por stdio");
}

main().catch((error) => {
  console.error("Error fatal al iniciar el servidor:", error);
  process.exit(1);
});