import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { UnauthorizedError } from './auth';

/** Every endpoint answers with the same envelope, so the client has one error path. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(code: string, message: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json({ error: { code, message, details } } satisfies ApiError, { status });
}

const MAX_BODY_BYTES = 200_000;

/** Parses and validates a JSON body, refusing anything oversized or malformed. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new PayloadTooLargeError();
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new PayloadTooLargeError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new BadRequestError('Request body must be JSON.');
  }
  return schema.parse(parsed);
}

export class BadRequestError extends Error {}
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body is too large.');
  }
}
export class NotFoundError extends Error {
  constructor(message = 'Not found.') {
    super(message);
  }
}
export class ConflictError extends Error {}

/** One place that turns a thrown error into a structured response. */
export function handleError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) return fail('UNAUTHORIZED', error.message, 401);
  if (error instanceof NotFoundError) return fail('NOT_FOUND', error.message, 404);
  if (error instanceof ConflictError) return fail('CONFLICT', error.message, 409);
  if (error instanceof PayloadTooLargeError) return fail('PAYLOAD_TOO_LARGE', error.message, 413);
  if (error instanceof BadRequestError) return fail('BAD_REQUEST', error.message, 400);
  if (error instanceof ZodError) {
    return fail('VALIDATION_FAILED', 'The request did not match the expected shape.', 422, {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  // Configuration mistakes are the one internal detail worth surfacing verbatim.
  if (/AUTH_SECRET|MONGODB_URI|LLM_|API key/i.test(message)) {
    return fail('MISCONFIGURED', message, 500);
  }
  console.error('[api]', error);
  return fail('INTERNAL', 'Something went wrong on our side.', 500);
}

export function withErrorHandling<Args extends unknown[], R extends Response>(
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}
