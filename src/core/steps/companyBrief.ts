import { z } from 'zod';
import type { FetchedPage } from '../net/fetcher';
import { generateJson } from '../llm/json';
import { dataBlock, SAFETY_RULES } from '../llm/prompts';
import type { CompanyBrief } from '../types';

/**
 * Step 5. Write the company brief strictly from retrieved pages.
 * With nothing retrieved we return an honest "we could not find out" brief
 * rather than letting the model write from memory.
 */

const ModelOutput = z.object({
  company_name: z.string().max(160).default(''),
  summary: z.string().max(1200).default(''),
  what_they_do: z.string().max(2000).default(''),
  confident: z.boolean().default(true),
});

export interface CompanyBriefInput {
  pages: FetchedPage[];
  companyUrl: string;
  fallbackName: string;
}

export async function generateCompanyBrief({
  pages,
  companyUrl,
  fallbackName,
}: CompanyBriefInput): Promise<{ brief: CompanyBrief; companyName: string; notes: string[] }> {
  if (pages.length === 0) {
    return {
      brief: {
        summary: `No pages could be retrieved from ${companyUrl}, so this brief is empty rather than guessed.`,
        what_they_do:
          'Unknown — the company site could not be read. Research the company manually before the interview.',
        sources: [],
        origin: 'generated',
        pinned: false,
      },
      companyName: fallbackName,
      notes: [`Company brief is empty: nothing could be retrieved from ${companyUrl}.`],
    };
  }

  // The homepage plus the most substantial other pages; brief-writing is about
  // what the company does, so we favour text volume over hiring signal here.
  // Three pages at 5k characters keeps one call under ~4k tokens, which matters:
  // free tiers cap tokens per minute, and this step runs alongside four others.
  const chosen = [pages[0], ...pages.slice(1).sort((a, b) => b.text.length - a.text.length)].slice(0, 3);

  const output = await generateJson({
    label: 'company-brief',
    system: [
      SAFETY_RULES,
      'You write a short factual brief about a company using only the supplied pages.',
      'Use only facts present in the pages. If the pages are thin, write a short brief and set',
      'confident=false. Never fill gaps from prior knowledge about this or any similar company.',
      'No marketing tone: a candidate should learn what the company actually does.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 1400,
    schema: ModelOutput,
    user: [
      ...chosen.map((p) =>
        dataBlock({ label: `company_page ${p.url}`, content: `${p.title}\n${p.text}`, maxChars: 5000 }),
      ),
      '',
      'Return JSON: { "company_name": "string", "summary": "2-4 sentences a candidate can use",',
      '  "what_they_do": "products, customers and business model as stated", "confident": boolean }',
    ].join('\n'),
  });

  const notes: string[] = [];
  if (!output.confident || output.what_they_do.length < 60) {
    notes.push(
      `Company pages were retrieved but thin; the brief reflects only what ${companyUrl} actually states.`,
    );
  }

  return {
    brief: {
      summary: output.summary.trim(),
      what_they_do: output.what_they_do.trim(),
      sources: chosen.map((p) => p.url),
      origin: 'generated',
      pinned: false,
    },
    companyName: output.company_name.trim() || fallbackName,
    notes,
  };
}
