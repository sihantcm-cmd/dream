import { AsyncLocalStorage } from 'node:async_hooks';

export type AiEnvironment = Readonly<Record<string, string | undefined>>;

const requestEnvironment = new AsyncLocalStorage<AiEnvironment>();

// A cloud request is a complete configuration boundary. Missing values in that
// snapshot must never fall back to another user's or the host's credentials.
export function getAiEnvironment(): AiEnvironment {
  return requestEnvironment.getStore() ?? process.env;
}

export function runWithAiEnvironment<T>(environment: AiEnvironment, operation: () => T): T {
  return requestEnvironment.run(Object.freeze({ ...environment }), operation);
}

export function getAiTimeoutMs(defaultMs: number): number {
  const configured = Number(getAiEnvironment().ONEIROS_AI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(defaultMs, Math.floor(configured))
    : defaultMs;
}
