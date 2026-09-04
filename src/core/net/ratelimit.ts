/**
 * One queue per host: at most N in flight and a minimum gap between requests,
 * so a crawl stays polite whether it is hitting one site or twenty.
 */
export class HostLimiter {
  private queues = new Map<string, Promise<unknown>>();
  private lastStart = new Map<string, number>();

  constructor(
    private minIntervalMs = 400,
    private concurrencyPerHost = 1,
  ) {}

  run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const slot = `${host}#${this.slotFor(host)}`;
    const prior = this.queues.get(slot) ?? Promise.resolve();
    const next = prior.then(async () => {
      const since = Date.now() - (this.lastStart.get(host) ?? 0);
      if (since < this.minIntervalMs) await sleep(this.minIntervalMs - since);
      this.lastStart.set(host, Date.now());
      return task();
    });
    // Keep the chain alive even when a task rejects.
    this.queues.set(
      slot,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private counter = 0;
  private slotFor(_host: string): number {
    return this.concurrencyPerHost <= 1 ? 0 : this.counter++ % this.concurrencyPerHost;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Return false to give up immediately (e.g. a 404 will never succeed). */
  isRetryable?: (error: unknown) => boolean;
}

/** Exponential backoff with full jitter, honouring a Retry-After hint when present. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 20_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (opts.isRetryable && !opts.isRetryable(error)) throw error;
      if (attempt === attempts) break;
      const hinted = retryAfterMs(error);
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      const delay = hinted ?? Math.round(backoff / 2 + Math.random() * (backoff / 2));
      opts.onRetry?.(attempt, error, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

function retryAfterMs(error: unknown): number | undefined {
  const value = (error as { retryAfterMs?: number })?.retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
