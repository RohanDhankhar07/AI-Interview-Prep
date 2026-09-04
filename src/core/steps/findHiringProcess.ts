import { z } from 'zod';
import type { FetchedPage } from '../net/fetcher';
import { generateJson } from '../llm/json';
import { dataBlock, SAFETY_RULES } from '../llm/prompts';

/**
 * Step 4. Given the crawled pages, work out whether the company publishes how it
 * hires — and if so, what the stages are.
 *
 * Candidate selection is deterministic keyword density, so we only spend a model
 * call on a page that plausibly describes a process. If no page clears the bar we
 * say so; a company that documents nothing must not produce an invented process.
 */

const STAGE_TERMS = [
  'interview', 'hiring process', 'recruitment process', 'take-home', 'take home',
  'technical screen', 'phone screen', 'onsite', 'on-site', 'pair programming',
  'system design', 'coding challenge', 'culture fit', 'values interview',
  'hiring manager', 'panel', 'final round', 'offer stage', 'what to expect',
  'application process', 'assessment', 'first round', 'second round',
];

export interface HiringProcess {
  found: boolean;
  urls: string[];
  summary: string;
  stages: { name: string; description: string }[];
}

/** How strongly a page reads like a description of an interview process. */
export function hiringSignalScore(page: Pick<FetchedPage, 'text' | 'title' | 'url'>): number {
  const haystack = `${page.title} ${page.url} ${page.text}`.toLowerCase();
  let score = 0;
  for (const term of STAGE_TERMS) {
    const hits = haystack.split(term).length - 1;
    if (hits > 0) score += Math.min(hits, 4) * (term.includes('process') || term === 'interview' ? 3 : 2);
  }
  // A page that merely lists vacancies is not a description of the process.
  if (/\b(apply now|view (all )?(open )?(roles|positions|jobs))\b/.test(haystack)) score -= 2;
  return score;
}

const MIN_SIGNAL = 12;

const ModelOutput = z.object({
  describes_hiring_process: z.boolean(),
  summary: z.string().max(1200).default(''),
  stages: z
    .array(z.object({ name: z.string().max(120), description: z.string().max(400).default('') }))
    .max(10)
    .default([]),
});

export async function findHiringProcess(pages: FetchedPage[]): Promise<HiringProcess> {
  const empty: HiringProcess = { found: false, urls: [], summary: '', stages: [] };
  if (pages.length === 0) return empty;

  const candidates = pages
    .map((page) => ({ page, score: hiringSignalScore(page) }))
    .filter((c) => c.score >= MIN_SIGNAL)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (candidates.length === 0) return empty;

  const output = await generateJson({
    label: 'hiring-process',
    system: [
      SAFETY_RULES,
      'You determine whether the supplied company pages describe the company\'s own interview or hiring process.',
      'Answer describes_hiring_process=false unless the pages actually set out stages, formats or what a',
      'candidate should expect. A page that only lists open vacancies is not a hiring process.',
      'Summarise only what the pages state. Do not generalise from what companies usually do.',
    ].join(' '),
    temperature: 0.1,
    maxTokens: 1200,
    schema: ModelOutput,
    user: [
      ...candidates.map((c) =>
        dataBlock({ label: `company_page ${c.page.url}`, content: c.page.text, maxChars: 9000 }),
      ),
      '',
      'Return JSON: { "describes_hiring_process": boolean, "summary": "string",',
      '  "stages": [{ "name": "string", "description": "string" }] }',
    ].join('\n'),
  });

  if (!output.describes_hiring_process) return { ...empty, urls: [] };

  return {
    found: true,
    urls: candidates.map((c) => c.page.url),
    summary: output.summary.trim(),
    stages: output.stages,
  };
}
