import { HostLimiter, withRetry, sleep } from '../net/ratelimit';
import { createOfflineProvider } from './offline';

/**
 * Provider-agnostic LLM client. Free tiers cap tokens per minute as well as
 * requests, so calls are serialised through a limiter and 429s are retried with
 * the provider's own Retry-After hint before falling back to exponential backoff.
 */

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for strict JSON where it supports it. */
  json?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    public code: 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'NOT_CONFIGURED',
    message: string,
    public status?: number,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

const limiter = new HostLimiter(
  Number(process.env.LLM_MIN_INTERVAL_MS ?? 350),
  Number(process.env.LLM_CONCURRENCY ?? 2),
);

const PRESETS: Record<string, { baseUrl: string; model: string; keyEnv: string }> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyEnv: 'GROQ_API_KEY',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyEnv: 'OPENROUTER_API_KEY',
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
    keyEnv: 'CEREBRAS_API_KEY',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
    keyEnv: 'GEMINI_API_KEY',
  },
};

function envKey(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** An OpenAI-compatible chat completions endpoint. Covers Groq, OpenRouter, Cerebras, Together, local servers. */
class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private baseUrl: string,
    readonly model: string,
    private apiKey: string,
  ) {}

  async complete(req: CompletionRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 90_000)),
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });

    if (!res.ok) throw await providerError(res);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LlmError('PROVIDER_ERROR', 'Provider returned no content');
    return content;
  }
}

class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  constructor(
    private baseUrl: string,
    readonly model: string,
    private apiKey: string,
  ) {}

  async complete(req: CompletionRequest): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 90_000)),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: req.temperature ?? 0.3,
            maxOutputTokens: req.maxTokens ?? 2048,
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
    );

    if (!res.ok) throw await providerError(res);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new LlmError('PROVIDER_ERROR', 'Provider returned no content');
    return text;
  }
}

async function providerError(res: Response): Promise<LlmError> {
  const body = await res.text().catch(() => '');
  const retryAfterHeader = Number(res.headers.get('retry-after'));
  // Groq and friends often report "Please try again in 6.7s" in the body only.
  const fromBody = /try again in ([\d.]+)\s*s/i.exec(body)?.[1];
  const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? retryAfterHeader * 1000
    : fromBody
      ? Math.ceil(Number(fromBody) * 1000)
      : undefined;

  if (res.status === 429) {
    return new LlmError('RATE_LIMITED', `Rate limited: ${body.slice(0, 300)}`, 429, retryAfterMs);
  }
  return new LlmError(
    'PROVIDER_ERROR',
    `Provider HTTP ${res.status}: ${body.slice(0, 300)}`,
    res.status,
    retryAfterMs,
  );
}

/** Deterministic offline provider, used by tests and by `LLM_PROVIDER=mock`. */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock';
  constructor(private handler: (req: CompletionRequest) => string) {}
  async complete(req: CompletionRequest): Promise<string> {
    await sleep(1);
    return this.handler(req);
  }
}

let offlineCache: LlmProvider | null = null;
function offlineProvider(): LlmProvider {
  offlineCache ??= createOfflineProvider();
  return offlineCache;
}

let override: LlmProvider | null = null;
/** Test seam: swap the provider without touching the pipeline. */
export function setLlmProvider(provider: LlmProvider | null): void {
  override = provider;
}

export function getLlmProvider(): LlmProvider {
  if (override) return override;

  const name = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
  // Deliberately explicit: the offline model is never a silent fallback for a
  // missing key, only something you ask for by name.
  if (name === 'mock' || name === 'offline') return offlineProvider();
  const preset = PRESETS[name];
  const baseUrl = envKey('LLM_BASE_URL') ?? preset?.baseUrl;
  const model = envKey('LLM_MODEL') ?? preset?.model;
  const apiKey = envKey('LLM_API_KEY') ?? (preset ? envKey(preset.keyEnv) : undefined);

  if (!baseUrl || !model) {
    throw new LlmError('NOT_CONFIGURED', `Unknown LLM_PROVIDER "${name}" and no LLM_BASE_URL/LLM_MODEL set`);
  }
  if (!apiKey) {
    throw new LlmError(
      'NOT_CONFIGURED',
      `No API key for provider "${name}". Set ${preset?.keyEnv ?? 'LLM_API_KEY'} (see .env.example).`,
    );
  }

  return name === 'gemini'
    ? new GeminiProvider(baseUrl, model, apiKey)
    : new OpenAiCompatibleProvider(name, baseUrl, model, apiKey);
}

/**
 * Every model call in the system goes through here: queued, retried, and with
 * rate limits treated as a normal condition rather than a failure.
 */
export async function complete(req: CompletionRequest): Promise<string> {
  const provider = getLlmProvider();
  return limiter.run(`llm:${provider.name}`, () =>
    withRetry(() => provider.complete(req), {
      attempts: Number(process.env.LLM_RETRY_ATTEMPTS ?? 4),
      baseDelayMs: 1200,
      maxDelayMs: 30_000,
      isRetryable: (error) => {
        if (!(error instanceof LlmError)) return true;
        if (error.code === 'NOT_CONFIGURED') return false;
        return error.code !== 'PROVIDER_ERROR' || (error.status ?? 500) >= 500 || error.status === 408;
      },
    }),
  );
}
