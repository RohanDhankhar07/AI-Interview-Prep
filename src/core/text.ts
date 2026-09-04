import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Deterministic identity for "the same posting submitted twice". */
export function caseFingerprint(jd: string, companyUrl: string): string {
  return sha256(`${normaliseWhitespace(jd).toLowerCase()}::${companyUrl.trim().toLowerCase()}`);
}

export function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Cut to a character budget on a word boundary, so prompts stay inside token limits. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut) + ' …[truncated]';
}

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','for','with','on','at','by','from','as','is','are',
  'be','you','your','we','our','will','have','has','experience','years','year','strong','good',
  'ability','work','working','using','use','plus','etc','including','across','into','their','this',
]);

/** Bag of significant tokens, used by the deterministic coverage matcher. */
export function keywords(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return new Set(words);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
