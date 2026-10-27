// =====================================================
// Reintentos con exponential backoff
// Espera 0.5s, 1s, 2s, 4s... (cada vez el doble) en vez
// de reintentar inmediatamente, para no empeorar un rate limit.
// =====================================================

import { GitHubAPIError, toAppError } from "../errors/index.js";
import { logger } from "./logging.js";

export interface RetryOptions {
  /** Cantidad máxima de reintentos (además del primer intento). */
  retries?: number;
  /** Espera inicial en milisegundos. */
  baseDelayMs?: number;
  /** Espera máxima entre intentos. */
  maxDelayMs?: number;
  /** Se puede reemplazar en los tests para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    sleep = defaultSleep,
  } = options;

  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const appError = toAppError(error);

      // Si el error no se arregla reintentando (404, 401, 422...) o ya
      // agotamos los intentos, lo dejamos subir.
      if (!appError.retryable || attempt >= retries) throw error;

      // Si GitHub pide esperar más de lo razonable, no bloqueamos al agente:
      // cortamos y devolvemos el mensaje para que el usuario decida.
      const serverWait =
        appError instanceof GitHubAPIError ? appError.retryAfterMs : undefined;
      if (serverWait !== undefined && serverWait > maxDelayMs) throw error;

      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.floor(Math.random() * 100);
      const delay = Math.max(backoff, serverWait ?? 0) + jitter;

      attempt++;
      logger.warn("Reintentando operación contra GitHub", {
        attempt,
        delayMs: delay,
        reason: appError.code,
      });

      await sleep(delay);
    }
  }
}