// =====================================================
// Lógica común a todas las tools:
//   validar -> ejecutar -> responder (o traducir el error)
// + métricas de uso (extra credit)
// =====================================================

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { validateInput } from "../schemas/index.js";
import { toAppError, toToolErrorResult } from "../errors/index.js";
import { logger } from "../utils/logging.js";

// ---------------- Métricas de uso ----------------
const usage = new Map<string, { calls: number; errors: number }>();

/** Devuelve cuántas veces se usó cada tool y cuántas fallaron. */
export function getToolMetrics(): Record<string, { calls: number; errors: number }> {
  return Object.fromEntries(usage);
}

/** Solo para tests. */
export function resetToolMetrics(): void {
  usage.clear();
}

// ---------------- Ejecución común ----------------
export interface ToolOutput {
  /** Frase corta en lenguaje natural para el LLM. */
  summary: string;
  /** Datos estructurados opcionales (se envían como JSON). */
  data?: unknown;
}

export async function executeTool<S extends z.ZodTypeAny>(
  toolName: string,
  schema: S,
  args: unknown,
  action: (input: z.output<S>) => Promise<ToolOutput>
): Promise<CallToolResult> {
  const stats = usage.get(toolName) ?? { calls: 0, errors: 0 };
  stats.calls++;
  usage.set(toolName, stats);

  logger.debug("Tool invocada", { tool: toolName });

  try {
    const input = validateInput(schema, args);
    const { summary, data } = await action(input);

    const text =
      data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 2)}`;

    return { content: [{ type: "text", text }] };
  } catch (error) {
    stats.errors++;
    const appError = toAppError(error);
    logger.warn("Tool devolvió un error", { tool: toolName, code: appError.code });
    return toToolErrorResult(appError);
  }
}