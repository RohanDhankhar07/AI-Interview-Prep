import { sleep } from './ratelimit';

/**
 * A small robots.txt implementation: group directives by user-agent, then match
 * the longest applicable rule. Fetched once per origin and cached for the run.
 * If robots.txt cannot be fetched we allow the crawl (the standard's own
 * "unavailable means allowed" reading), but a 401/403 on it means disallow.
 */

interface Rule {
  allow: boolean;
  path: string;
}
interface RobotsFile {
  rules: Rule[];
  crawlDelayMs: number;
  allowAll: boolean;
}

const cache = new Map<string, Promise<RobotsFile>>();
const USER_AGENT_TOKEN = 'interviewprepkit';

export function robotsCacheClear(): void {
  cache.clear();
}

export function parseRobots(body: string, agent = USER_AGENT_TOKEN): RobotsFile {
  const lines = body.split(/\r?\n/);
  const groups: { agents: string[]; rules: Rule[]; crawlDelay?: number }[] = [];
  let current: { agents: string[]; rules: Rule[]; crawlDelay?: number } | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (!current) continue;
    lastWasAgent = false;
    if (field === 'disallow') current.rules.push({ allow: false, path: value });
    else if (field === 'allow') current.rules.push({ allow: true, path: value });
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a.includes(agent)));
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  const chosen = specific.length ? specific : wildcard;
  const rules = chosen.flatMap((g) => g.rules).filter((r) => r.path !== '');
  const crawlDelay = chosen.find((g) => g.crawlDelay !== undefined)?.crawlDelay ?? 0;

  return {
    rules,
    crawlDelayMs: Math.min(10_000, Math.max(0, crawlDelay * 1000)),
    allowAll: chosen.length === 0,
  };
}

function matches(rulePath: string, urlPath: string): boolean {
  // Supports the * wildcard and the $ end-anchor.
  if (!rulePath.includes('*') && !rulePath.endsWith('$')) return urlPath.startsWith(rulePath);
  const escaped = rulePath
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  return new RegExp(`^${escaped}`).test(urlPath);
}

export function isAllowedBy(robots: RobotsFile, urlPath: string): boolean {
  if (robots.allowAll) return true;
  let best: Rule | null = null;
  for (const rule of robots.rules) {
    if (!matches(rule.path, urlPath)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  return best ? best.allow : true;
}

async function loadRobots(origin: string): Promise<RobotsFile> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': USER_AGENT_TOKEN },
      redirect: 'follow',
    });
    if (res.status === 401 || res.status === 403) {
      return { rules: [{ allow: false, path: '/' }], crawlDelayMs: 0, allowAll: false };
    }
    if (!res.ok) return { rules: [], crawlDelayMs: 0, allowAll: true };
    const body = (await res.text()).slice(0, 200_000);
    return parseRobots(body);
  } catch {
    return { rules: [], crawlDelayMs: 0, allowAll: true };
  }
}

export async function robotsFor(url: URL): Promise<RobotsFile> {
  const origin = url.origin;
  let entry = cache.get(origin);
  if (!entry) {
    entry = loadRobots(origin);
    cache.set(origin, entry);
  }
  return entry;
}

export async function isCrawlAllowed(url: URL): Promise<{ allowed: boolean; crawlDelayMs: number }> {
  if (process.env.RESPECT_ROBOTS === 'false') return { allowed: true, crawlDelayMs: 0 };
  const robots = await robotsFor(url);
  return { allowed: isAllowedBy(robots, url.pathname), crawlDelayMs: robots.crawlDelayMs };
}

export async function applyCrawlDelay(url: URL): Promise<void> {
  const { crawlDelayMs } = await isCrawlAllowed(url);
  if (crawlDelayMs > 0) await sleep(crawlDelayMs);
}
