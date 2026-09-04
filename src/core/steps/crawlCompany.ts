import { fetchPage, FetchError, type FetchedPage } from '../net/fetcher';
import { parseUrl } from '../net/ssrf';

/**
 * Step 2/3. Crawl the company site and decide, from the links themselves, which
 * pages are worth spending a fetch on.
 *
 * A fixed list of paths is not enough: /careers, /jobs, /handbook/hiring and
 * /blog/how-we-interview are all real. So we score every discovered link on its
 * path tokens, its anchor text and its depth, then spend a small budget on the
 * best ones. Conventional paths are only ever a fallback for a site whose
 * homepage links nowhere useful.
 */

export interface ScoredLink {
  url: string;
  anchor: string;
  score: number;
  depth: number;
}

export interface CrawlResult {
  pages: FetchedPage[];
  skipped: { url: string; reason: string }[];
  homepage: FetchedPage | null;
  /** Ranked links we found but had no budget to fetch — useful for reporting. */
  unvisited: ScoredLink[];
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  timeBudgetMs?: number;
  onProgress?: (message: string) => void;
}

/** Path/anchor tokens that suggest a page describes how the company hires. */
const HIRING_SIGNALS: [RegExp, number][] = [
  [/interview(ing|s)?[-_/]?(process|guide|prep)?/, 22],
  [/hiring[-_/]?(process|guide|handbook)?/, 20],
  [/how[-_ ]we[-_ ](hire|interview|work)/, 24],
  [/recruit(ing|ment)?/, 14],
  [/careers?/, 14],
  [/jobs?/, 12],
  [/join[-_ ]?(us|the[-_ ]team)?/, 10],
  [/handbook/, 12],
  [/candidate/, 12],
  [/apply|application/, 6],
  [/life[-_ ]at/, 8],
  [/work(ing)?[-_ ]?(at|with)[-_ ]?us/, 8],
  [/culture|values|people/, 6],
];

/** Tokens that suggest a page explains what the company does. */
const ABOUT_SIGNALS: [RegExp, number][] = [
  [/about([-_ ]us)?/, 14],
  [/what[-_ ]we[-_ ]do/, 14],
  [/company|mission|story/, 8],
  [/products?|platform|solutions?/, 7],
  [/customers?|case[-_ ]stud/, 5],
  [/engineering|tech(nology)?[-_ ]?blog/, 6],
  [/team|leadership/, 4],
  [/docs?|documentation/, 2],
];

const PENALTIES: [RegExp, number][] = [
  [/\.(pdf|jpe?g|png|gif|svg|zip|mp4|webm|css|js|ico|xml|rss)(\?|$)/, -100],
  [/(login|signin|sign-in|signup|register|account|dashboard|app)\//, -40],
  [/(privacy|terms|legal|cookie|gdpr|security-policy|imprint)/, -40],
  [/(cart|checkout|pricing|billing)/, -15],
  [/\/(tag|tags|category|categories|author|archive|page)\//, -20],
  [/\/(support|help|status|contact)\//, -8],
  [/#|utm_|\?.{40,}/, -10],
];

/** Applicant tracking systems: off-domain, but exactly where hiring detail lives. */
const ATS_HOSTS = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.ashbyhq.com',
  'apply.workable.com',
  'careers.smartrecruiters.com',
  'jobs.workable.com',
];

/** Conventional paths, tried only when link discovery produced nothing worth fetching. */
const FALLBACK_PATHS = ['/careers', '/jobs', '/about', '/company', '/handbook', '/join-us'];

export function registrableHost(host: string): string {
  const parts = host.toLowerCase().split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || /^[\d.]+$/.test(hostname);
}

export function isSameSite(candidate: URL, seed: URL): boolean {
  // A local host often serves several fixture companies from one port, separated
  // only by a path prefix (/acme/, /quietco/). Staying inside the seed's own
  // prefix keeps a crawl from wandering into a different company's site.
  if (isLocalHost(seed.hostname)) {
    if (candidate.host !== seed.host) return false;
    const prefix = seedPrefix(seed);
    return prefix === '/' || candidate.pathname === prefix.slice(0, -1) || candidate.pathname.startsWith(prefix);
  }
  if (candidate.host === seed.host) return true;
  return registrableHost(candidate.host) === registrableHost(seed.host);
}

/** The seed's directory: /acme/ for /acme/ and for /acme/careers, / for the root. */
function seedPrefix(seed: URL): string {
  const segments = seed.pathname.split('/').filter(Boolean);
  return segments.length === 0 ? '/' : `/${segments[0]}/`;
}

/**
 * Pure scoring function: how likely is this link to be worth a fetch?
 * Exported so the ranking behaviour is directly testable.
 */
export function scoreLink(rawUrl: string, anchor: string, seed: URL, depth: number): number {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return -Infinity;
  }

  const onAts = ATS_HOSTS.some((h) => url.host.endsWith(h));
  if (!isSameSite(url, seed) && !onAts) return -Infinity;

  const path = url.pathname.toLowerCase();
  const text = anchor.toLowerCase().slice(0, 100);
  let score = onAts ? 18 : 0;

  for (const [pattern, weight] of HIRING_SIGNALS) {
    if (pattern.test(path)) score += weight;
    if (pattern.test(text)) score += Math.round(weight * 0.7);
  }
  for (const [pattern, weight] of ABOUT_SIGNALS) {
    if (pattern.test(path)) score += weight;
    if (pattern.test(text)) score += Math.round(weight * 0.7);
  }
  for (const [pattern, weight] of PENALTIES) {
    if (pattern.test(path) || pattern.test(url.search)) score += weight;
  }

  // Shallow, short paths beat deep ones; the root itself is not a candidate.
  const segments = path.split('/').filter(Boolean);
  score -= depth * 4;
  score -= Math.max(0, segments.length - 2) * 3;
  if (segments.length === 0) score -= 5;

  return score;
}

export async function crawlCompany(seedUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 7;
  const maxDepth = opts.maxDepth ?? 2;
  const deadline = Date.now() + (opts.timeBudgetMs ?? 60_000);
  const progress = opts.onProgress ?? (() => {});

  const seed = parseUrl(seedUrl);
  const pages: FetchedPage[] = [];
  const skipped: CrawlResult['skipped'] = [];
  const visited = new Set<string>();
  const frontier = new Map<string, ScoredLink>();

  const remember = (url: string, anchor: string, depth: number) => {
    const key = normaliseKey(url);
    if (!key || visited.has(key) || frontier.has(key)) return;
    const score = scoreLink(url, anchor, seed, depth);
    if (score === -Infinity || score <= 0) return;
    frontier.set(key, { url, anchor, score, depth });
  };

  progress(`Fetching ${seed.toString()}`);
  let homepage: FetchedPage | null = null;
  try {
    homepage = await fetchPage(seed.toString());
    visited.add(normaliseKey(homepage.url));
    visited.add(normaliseKey(seed.toString()));
    pages.push(homepage);
  } catch (error) {
    skipped.push({ url: seed.toString(), reason: describe(error) });
    return { pages, skipped, homepage: null, unvisited: [] };
  }

  for (const link of homepage.links) remember(link.url, link.text, 1);
  for (const url of await sitemapUrls(seed)) remember(url, '', 1);

  // Nothing on the homepage pointed anywhere promising: try the conventional paths.
  if (frontier.size === 0) {
    for (const path of FALLBACK_PATHS) remember(new URL(path, seed).toString(), path, 1);
  }

  while (pages.length < maxPages && frontier.size > 0 && Date.now() < deadline) {
    const next = [...frontier.values()].sort((a, b) => b.score - a.score)[0];
    frontier.delete(normaliseKey(next.url));
    visited.add(normaliseKey(next.url));

    try {
      progress(`Fetching ${next.url}`);
      const page = await fetchPage(next.url);
      pages.push(page);
      visited.add(normaliseKey(page.url));
      if (next.depth < maxDepth) {
        for (const link of page.links) remember(link.url, link.text, next.depth + 1);
      }
    } catch (error) {
      // A source we cannot retrieve is recorded and skipped, never fatal.
      skipped.push({ url: next.url, reason: describe(error) });
    }
  }

  return {
    pages,
    skipped,
    homepage,
    unvisited: [...frontier.values()].sort((a, b) => b.score - a.score).slice(0, 10),
  };
}

/** sitemap.xml is the cheapest way to discover a /handbook/hiring nobody links to. */
async function sitemapUrls(seed: URL): Promise<string[]> {
  try {
    const res = await fetch(new URL('/sitemap.xml', seed), {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'InterviewPrepKitBot/1.0' },
    });
    if (!res.ok) return [];
    const body = (await res.text()).slice(0, 500_000);
    return [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, 300);
  } catch {
    return [];
  }
}

function normaliseKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
}

export function describe(error: unknown): string {
  if (error instanceof FetchError) return `${error.code}: ${error.message}`;
  return (error as Error)?.message ?? String(error);
}
