// =====================================================
// Tools de EXTRA CREDIT:
// create_branch, close_issue, add_comment_to_issue,
// list_commits y health_check
// =====================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createBranchShape,
  createBranchSchema,
  closeIssueShape,
  closeIssueSchema,
  addCommentShape,
  addCommentSchema,
  listCommitsShape,
  listCommitsSchema,
} from "../schemas/index.js";
import {
  createBranch,
  closeIssue,
  addCommentToIssue,
  listCommits,
  healthCheck,
} from "../github/operations.js";
import { executeTool, getToolMetrics } from "./helpers.js";

export function registerExtraTools(server: McpServer): void {
  // ---------- create_branch ----------
  server.registerTool(
    "create_branch",
    {
      title: "Crear branch",
      description:
        "Crea una branch nueva en un repositorio de GitHub, a partir de la branch principal o de la que se indique. " +
        "Usala cuando el usuario quiera empezar una feature, un fix o trabajar en paralelo sin tocar la branch principal.",
      inputSchema: createBranchShape,
    },
    async (args) =>
      executeTool("create_branch", createBranchSchema, args, async (input) => {
        const branch = await createBranch(input);
        return {
          summary: `Branch "${branch.name}" creada a partir de "${branch.fromBranch}". Link: ${branch.url}`,
          data: branch,
        };
      })
  );

  // ---------- close_issue ----------
  server.registerTool(
    "close_issue",
    {
      title: "Cerrar issue",
      description:
        "Cierra un issue existente de un repositorio de GitHub, opcionalmente dejando un comentario con el motivo. " +
        "Usala cuando el usuario diga que un issue está resuelto, terminado o ya no aplica. Requiere el número del issue " +
        "(si no lo sabés, primero usá list_issues).",
      inputSchema: closeIssueShape,
    },
    async (args) =>
      executeTool("close_issue", closeIssueSchema, args, async (input) => {
        const issue = await closeIssue(input);
        return {
          summary: `Issue #${issue.number} "${issue.title}" cerrado. Link: ${issue.url}`,
          data: issue,
        };
      })
  );

  // ---------- add_comment_to_issue ----------
  server.registerTool(
    "add_comment_to_issue",
    {
      title: "Comentar issue",
      description:
        "Agrega un comentario a un issue existente de un repositorio de GitHub. " +
        "Usala cuando el usuario quiera responder, dar una actualización o dejar una nota en un issue. " +
        "Requiere el número del issue (si no lo sabés, primero usá list_issues).",
      inputSchema: addCommentShape,
    },
    async (args) =>
      executeTool("add_comment_to_issue", addCommentSchema, args, async (input) => {
        const comment = await addCommentToIssue(input);
        return {
          summary: `Comentario agregado al issue #${comment.issueNumber}. Link: ${comment.url}`,
          data: comment,
        };
      })
  );

  // ---------- list_commits ----------
  server.registerTool(
    "list_commits",
    {
      title: "Listar commits",
      description:
        "Lista los commits más recientes de un repositorio de GitHub (de la branch principal o de la que se indique). " +
        "Usala cuando el usuario pregunte qué cambios se hicieron últimamente, quién hizo un cambio o quiera ver el historial.",
      inputSchema: listCommitsShape,
    },
    async (args) =>
      executeTool("list_commits", listCommitsSchema, args, async (input) => {
        const commits = await listCommits(input);
        return {
          summary:
            commits.length === 0
              ? `No se encontraron commits en ${input.repo}.`
              : `Últimos ${commits.length} commit(s) de ${input.repo}.`,
          data: commits,
        };
      })
  );

  // ---------- health_check ----------
  server.registerTool(
    "health_check",
    {
      title: "Verificar conexión con GitHub",
      description:
        "Verifica que el servidor puede conectarse a GitHub: muestra el usuario autenticado, los permisos (scopes) del token, " +
        "cuántas solicitudes quedan disponibles y métricas de uso de las tools. " +
        "Usala si el usuario pregunta si la conexión funciona, o para diagnosticar errores de permisos o autenticación.",
      inputSchema: {},
    },
    async (args) =>
      executeTool("health_check", z.object({}), args ?? {}, async () => {
        const status = await healthCheck();
        const warning =
          status.missingScopes.length > 0
            ? ` Atención: al token le faltan los scopes ${status.missingScopes.join(", ")}.`
            : " El token tiene todos los permisos necesarios.";
        return {
          summary: `Conexión OK como ${status.login}. Quedan ${status.rateLimit.remaining}/${status.rateLimit.limit} solicitudes.${warning}`,
          data: { ...status, toolMetrics: getToolMetrics() },
        };
      })
  );
}