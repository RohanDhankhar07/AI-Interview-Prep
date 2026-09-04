import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';
import { complete, getLlmProvider, LlmError, setLlmProvider } from '../src/core/llm/provider';
import { generateJson } from '../src/core/llm/json';

/**
 * The real HTTP path, against a local stand-in for an OpenAI-compatible provider
 * (Groq, OpenRouter, Cerebras) and for Gemini. Without this the only exercised
 * provider would be the in-process mock, and a wrong request shape would only
 * show up in production.
 */

let server: Server;
let base: string;
const requests: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
let script: (() => { status: number; body: unknown; headers?: Record<string, string> })[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({
        url: req.url ?? '',
        body: raw ? JSON.parse(raw) : {},
        auth: req.headers.authorization,
      });
      const next = script.shift();
      const result = next
        ? next()
        : {
            status: 200,
            body: { choices: [{ message: { content: '{"ok":true}' } }] },
          };
      res.writeHead(result.status, { 'content-type': 'application/json', ...(result.headers ?? {}) });
      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

afterEach(() => {
  requests.length = 0;
  script = [];
  setLlmProvider(null);
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_PROVIDER;
});

function useOpenAiCompatible() {
  process.env.LLM_PROVIDER = 'groq';
  process.env.LLM_BASE_URL = base;
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
}

describe('OpenAI-compatible providers', () => {
  it('sends the request shape those APIs expect', async () => {
    useOpenAiCompatible();
    const text = await complete({ system: 'be terse', user: 'say json', json: true, maxTokens: 100 });

    expect(text).toBe('{"ok":true}');
    expect(requests[0].url).toBe('/chat/completions');
    expect(requests[0].auth).toBe('Bearer test-key');
    expect(requests[0].body).toMatchObject({
      model: 'test-model',
      max_tokens: 100,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'say json' },
      ],
    });
  });

  it('waits out a 429 and succeeds on the retry', async () => {
    useOpenAiCompatible();
    script = [
      () => ({
        status: 429,
        headers: { 'retry-after': '1' },
        body: { error: { message: 'Rate limit reached' } },
      }),
      () => ({ status: 200, body: { choices: [{ message: { content: '{"ok":true}' } }] } }),
    ];

    const started = Date.now();
    await expect(complete({ system: 's', user: 'u' })).resolves.toBe('{"ok":true}');
    expect(requests).toHaveLength(2);
    // Retry-After was honoured rather than retried immediately.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('reads the delay out of a provider that only puts it in the body', async () => {
    useOpenAiCompatible();
    script = [
      () => ({ status: 429, body: { error: { message: 'Please try again in 0.5s.' } } }),
      () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } }),
    ];
    await expect(complete({ system: 's', user: 'u' })).resolves.toBe('ok');
  });

  it('gives up immediately on a 400, which no retry can fix', async () => {
    useOpenAiCompatible();
    script = [() => ({ status: 400, body: { error: { message: 'bad model' } } })];
    await expect(complete({ system: 's', user: 'u' })).rejects.toThrow(LlmError);
    expect(requests).toHaveLength(1);
  });

  it('refuses to run without a key rather than falling back to something else', () => {
    process.env.LLM_PROVIDER = 'groq';
    delete process.env.GROQ_API_KEY;
    expect(() => getLlmProvider()).toThrow(/No API key/);
  });

  it('selects the offline model only when asked for by name', () => {
    process.env.LLM_PROVIDER = 'mock';
    expect(getLlmProvider().name).toBe('mock');
  });
});

describe('Gemini', () => {
  it('sends the request shape the generateContent API expects', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_BASE_URL = base;
    process.env.LLM_API_KEY = 'gem-key';
    process.env.LLM_MODEL = 'gemini-test';
    script = [
      () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] } }),
    ];

    await expect(complete({ system: 'sys', user: 'usr', json: true })).resolves.toBe('{"ok":1}');
    expect(requests[0].url).toBe('/models/gemini-test:generateContent?key=gem-key');
    expect(requests[0].body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'usr' }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
  });
});

describe('generateJson over the wire', () => {
  const Schema = z.object({ title: z.string(), count: z.number() });

  it('accepts JSON wrapped in prose and a code fence', async () => {
    useOpenAiCompatible();
    script = [
      () => ({
        status: 200,
        body: {
          choices: [
            { message: { content: 'Sure!\n```json\n{"title":"a","count":2,}\n```\nHope that helps.' } },
          ],
        },
      }),
    ];
    await expect(generateJson({ system: 's', user: 'u', schema: Schema })).resolves.toEqual({
      title: 'a',
      count: 2,
    });
  });

  it('hands the model its own validation errors and takes the correction', async () => {
    useOpenAiCompatible();
    script = [
      () => ({ status: 200, body: { choices: [{ message: { content: '{"title":"a"}' } }] } }),
      () => ({ status: 200, body: { choices: [{ message: { content: '{"title":"a","count":3}' } }] } }),
    ];

    await expect(generateJson({ system: 's', user: 'u', schema: Schema })).resolves.toEqual({
      title: 'a',
      count: 3,
    });
    expect(requests).toHaveLength(2);
    expect(String(requests[1].body.messages)).toBeDefined();
    const second = (requests[1].body.messages as { role: string; content: string }[])[1].content;
    expect(second).toContain('could not be used');
    expect(second).toContain('count');
  });

  it('throws once it has run out of attempts', async () => {
    useOpenAiCompatible();
    script = Array.from({ length: 3 }, () => () => ({
      status: 200,
      body: { choices: [{ message: { content: 'no json here' } }] },
    }));
    await expect(generateJson({ system: 's', user: 'u', schema: Schema, label: 'x' })).rejects.toThrow(
      /did not return valid JSON/,
    );
  });
});
