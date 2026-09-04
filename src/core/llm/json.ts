import type { z } from 'zod';
import { complete, LlmError, type CompletionRequest } from './provider';

/**
 * Models return "JSON" that is sometimes fenced, prefixed with prose, or
 * trailing-comma'd. We repair what we can locally, and only then spend another
 * call asking the model to fix what it produced.
 */

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const candidates = [text, stripFence(text), balancedSlice(text)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const attempt of [candidate, repairCommon(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* try the next repair */
      }
    }
  }
  throw new SyntaxError(`No parseable JSON in model output: ${text.slice(0, 200)}`);
}

function stripFence(text: string): string | null {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return m ? m[1].trim() : null;
}

/** First balanced {...} or [...] block, ignoring braces inside strings. */
function balancedSlice(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function repairCommon(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .replace(/^﻿/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export interface GenerateJsonOptions<T> extends CompletionRequest {
  schema: z.ZodType<T>;
  /** Total attempts including the first. */
  attempts?: number;
  label?: string;
}

/**
 * One structured call: generate, parse, validate against the schema, and on
 * failure hand the model its own output plus the validation errors to correct.
 * A step that still cannot produce valid output throws, and the pipeline decides
 * whether that is fatal or a degradation it can carry on from.
 */
export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let user = opts.user;
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let raw: string;
    try {
      raw = await complete({ ...opts, user, json: true });
    } catch (error) {
      if (error instanceof LlmError && error.code === 'NOT_CONFIGURED') throw error;
      if (attempt === attempts) throw error;
      continue;
    }

    try {
      const parsed = opts.schema.safeParse(extractJson(raw));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    } catch (error) {
      lastError = (error as Error).message;
    }

    user = [
      opts.user,
      '',
      'Your previous reply could not be used.',
      `Problem: ${lastError}`,
      'Reply again with ONLY the corrected JSON object. No prose, no code fences.',
    ].join('\n');
  }

  throw new LlmError(
    'PROVIDER_ERROR',
    `${opts.label ?? 'generation'} did not return valid JSON after ${attempts} attempts: ${lastError}`,
  );
}
