import * as cheerio from 'cheerio';

export interface PageLink {
  url: string;
  text: string;
}

export interface ExtractedPage {
  title: string;
  text: string;
  links: PageLink[];
  description: string;
}

const STRIP = 'script, style, noscript, iframe, svg, canvas, template, form, [aria-hidden="true"]';
const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]';

/**
 * HTML in, plain text plus links out. Chrome (nav/header/footer) is dropped from
 * the text but its links are kept — on many sites the only pointer to a careers
 * page lives in the footer.
 */
export function extractFromHtml(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();
  const description = ($('meta[name="description"]').attr('content') ?? '').trim();

  const links: PageLink[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const resolved = resolveLink(href, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    links.push({ url: resolved, text: collapse($(el).text()).slice(0, 120) });
  });

  $(STRIP).remove();
  // cheerio.load always synthesises a <body>, so this branch is total.
  const $body = $('main').length ? $('main').first() : $('body');
  $body.find(CHROME).remove();

  // Keep block structure as newlines so headings do not run into paragraphs.
  $body.find('h1, h2, h3, h4, h5, h6, p, li, tr, br, div, section').each((_, el) => {
    $(el).after('\n');
  });

  const text = collapseLines($body.text());
  return { title, description, text, links };
}

/** Relative links must work: the batch runner may point us at a local host. */
export function resolveLink(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (/^(mailto:|tel:|javascript:|data:|file:)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function collapseLines(s: string): string {
  return s
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => collapse(line))
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
