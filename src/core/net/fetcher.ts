import { assertFetchable, BlockedUrlError, parseUrl } from './ssrf';
import { isCrawlAllowed } from './robots';
import { HostLimiter, withRetry } from './ratelimit';
import { extractFromHtml, type ExtractedPage } from './extract';

export type FetchErrorCode =
  | 'URL_BLOCKED'
  | 'ROBOTS_DISALLOWED'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'NETWORK';

export class FetchError extends Error {
  constructor(
    public code: FetchErrorCode,
    message: string,
    public status?: number,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface FetchedPage extends ExtractedPage {
  url: string;
  requestedUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  fetchedAt: string;
}

const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ??
  'InterviewPrepKitBot/1.0 (+research crawler; contact: set CRAWLER_USER_AGENT)';
const MAX_BYTES = Number(process.env.FETCH_MAX_BYTES ?? 2_000_000);
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 12_000);
const MAX_REDIRECTS = 4;
const ALLOWED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

const limiter = new HostLimiter(
  Number(process.env.FETCH_MIN_INTERVAL_MS ?? 350),
  Number(process.env.FETCH_CONCURRENCY_PER_HOST ?? 2),
);

/**
 * The single door to the open internet. Everything here is a defence:
 * URL validated before the request and after every redirect, robots respected,
 * requests rate-limited per host, response type and size constrained, and
 * transient failures retried with backoff.
 */
export async function fetchPage(rawUrl: string, opts: { timeoutMs?: number } = {}): Promise<FetchedPage> {
  const initial = await assertFetchable(rawUrl);
  const { allowed } = await isCrawlAllowed(initial);
  if (!allowed) {
    throw new FetchError('ROBOTS_DISALLOWED', `robots.txt disallows ${initial.pathname}`);
  }

  return limiter.run(initial.host, () =>
    withRetry(() => requestOnce(initial, rawUrl, opts.timeoutMs ?? TIMEOUT_MS), {
      attempts: 3,
      baseDelayMs: 600,
      isRetryable: (error) =>
        error instanceof FetchError &&
        (error.code === 'NETWORK' ||
          error.code === 'TIMEOUT' ||
          (error.code === 'HTTP_ERROR' && (error.status === 429 || (error.status ?? 0) >= 500))),
    }),
  );
}

async function requestOnce(startUrl: URL, requestedUrl: string, timeoutMs: number): Promise<FetchedPage> {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'accept-language': 'en',
        },
      });
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new FetchError('TIMEOUT', `Timed out after ${timeoutMs}ms: ${url}`);
      }
      throw new FetchError('NETWORK', `Network error for ${url}: ${(error as Error).message}`);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location')!, url);
      // Re-validate every hop: a redirect is an attacker-controlled URL too.
      url = await assertFetchable(next.toString());
      const { allowed } = await isCrawlAllowed(url);
      if (!allowed) throw new FetchError('ROBOTS_DISALLOWED', `robots.txt disallows ${url.pathname}`);
      continue;
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new FetchError(
        'HTTP_ERROR',
        `HTTP ${res.status} for ${url}`,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const mime = contentType.split(';')[0].trim();
    if (mime && !ALLOWED_TYPES.includes(mime)) {
      throw new FetchError('UNSUPPORTED_CONTENT_TYPE', `Refusing content-type ${mime} at ${url}`);
    }
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      throw new FetchError('TOO_LARGE', `${declaredLength} bytes exceeds cap at ${url}`);
    }

    const body = await readCapped(res, MAX_BYTES, url.toString());
    const page = mime === 'text/plain'
      ? { title: '', description: '', text: body.slice(0, 400_000), links: [] }
      : extractFromHtml(body, url.toString());

    return {
      ...page,
      url: url.toString(),
      requestedUrl,
      status: res.status,
      contentType: mime,
      bytes: body.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  throw new FetchError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects from ${requestedUrl}`);
}

/** Streams the body and aborts as soon as the cap is exceeded, so a huge page cannot exhaust memory. */
async function readCapped(res: Response, maxBytes: number, url: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchError('TOO_LARGE', `Body exceeded ${maxBytes} bytes at ${url}`);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

export { BlockedUrlError, parseUrl };
