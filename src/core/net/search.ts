/**
 * Web search with a graceful ladder of providers.
 *
 * A proper search API is used when a key is configured (recommended, and what
 * the deployed app uses). With no key we fall back to DuckDuckGo's public
 * endpoint, which needs no credentials but is best-effort: if it returns
 * nothing, the caller reports "no public discussion found" rather than failing.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProviderName = 'serper' | 'brave' | 'tavily' | 'duckduckgo' | 'none';

export function activeSearchProvider(): SearchProviderName {
  if (process.env.SERPER_API_KEY) return 'serper';
  if (process.env.BRAVE_API_KEY) return 'brave';
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.SEARCH_DISABLED === 'true') return 'none';
  return 'duckduckgo';
}

export async function searchWeb(query: string, limit = 6): Promise<SearchResult[]> {
  const provider = activeSearchProvider();
  try {
    switch (provider) {
      case 'serper':
        return await serper(query, limit);
      case 'brave':
        return await brave(query, limit);
      case 'tavily':
        return await tavily(query, limit);
      case 'duckduckgo':
        return await duckduckgo(query, limit);
      default:
        return [];
    }
  } catch {
    // Search is an enhancement, never a blocker.
    return [];
  }
}

const TIMEOUT = { signal: AbortSignal.timeout(12_000) } as const;

async function serper(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, num: limit }),
    ...TIMEOUT,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
  return (data.organic ?? [])
    .slice(0, limit)
    .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '' }));
}

async function brave(query: string, limit: number): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY!, accept: 'application/json' },
    ...TIMEOUT,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (data.web?.results ?? [])
    .slice(0, limit)
    .map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? '') }));
}

async function tavily(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: limit }),
    ...TIMEOUT,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (data.results ?? [])
    .slice(0, limit)
    .map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? '').slice(0, 300) }));
}

/** No API key required. Parsed defensively: any change in markup degrades to "no results". */
async function duckduckgo(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (compatible; InterviewPrepKitBot/1.0)',
    },
    body: new URLSearchParams({ q: query }).toString(),
    ...TIMEOUT,
  });
  if (!res.ok) return [];
  const html = (await res.text()).slice(0, 800_000);

  const results: SearchResult[] = [];
  const anchor = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchor)) {
    const url = decodeRedirect(m[1]);
    if (!url) continue;
    results.push({ title: stripTags(m[2]), url, snippet: '' });
    if (results.length >= limit) break;
  }
  if (results.length === 0) {
    // Older markup: plain result anchors with a uddg redirect.
    const fallback = /<a[^>]+href="(\/\/duckduckgo\.com\/l\/\?uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(fallback)) {
      const url = decodeRedirect(`https:${m[1]}`);
      if (!url) continue;
      results.push({ title: stripTags(m[2]), url, snippet: '' });
      if (results.length >= limit) break;
    }
  }
  return results;
}

function decodeRedirect(raw: string): string | null {
  try {
    const url = new URL(raw);
    const target = url.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return null;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
