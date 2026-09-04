import { z } from 'zod';
import { searchWeb, activeSearchProvider, type SearchResult } from '../net/search';
import { fetchPage } from '../net/fetcher';
import { generateJson } from '../llm/json';
import { dataBlock, SAFETY_RULES } from '../llm/prompts';
import { describe } from './crawlCompany';

/**
 * Step 6. Look for public discussion of how this company interviews — the
 * candidate-side view that a company's own careers page never gives.
 *
 * Aggregators that reliably block automated reads (Glassdoor, LinkedIn, Indeed)
 * are not fetched; where their snippet is all we have, we use only the snippet
 * and say so. Finding nothing is a normal outcome, not an error.
 */

export interface PublicDiscussion {
  found: boolean;
  urls: string[];
  summary: string;
  themes: string[];
  skipped: { url: string; reason: string }[];
  notes: string[];
}

const BLOCKED_HOSTS = [
  'glassdoor.', 'linkedin.com', 'indeed.', 'facebook.com', 'instagram.com',
  'x.com', 'twitter.com', 'quora.com', 'ambitionbox.com',
];

const ModelOutput = z.object({
  has_relevant_discussion: z.boolean(),
  summary: z.string().max(1500).default(''),
  themes: z.array(z.string().max(200)).max(8).default([]),
});

export interface PublicDiscussionInput {
  companyName: string;
  roleTitle: string;
  companyUrl: string;
  maxPages?: number;
}

export async function searchPublicDiscussion({
  companyName,
  roleTitle,
  maxPages = 3,
}: PublicDiscussionInput): Promise<PublicDiscussion> {
  const empty: PublicDiscussion = {
    found: false,
    urls: [],
    summary: '',
    themes: [],
    skipped: [],
    notes: [],
  };

  if (activeSearchProvider() === 'none') {
    return { ...empty, notes: ['Web search is disabled (SEARCH_DISABLED=true).'] };
  }
  if (!companyName.trim()) {
    return { ...empty, notes: ['Company name unknown, so public discussion could not be searched.'] };
  }

  const queries = [
    `"${companyName}" interview process experience`,
    `${companyName} ${roleTitle} interview questions`.trim(),
  ];

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    for (const r of await searchWeb(q, 6)) {
      const key = r.url.replace(/[#?].*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(r);
    }
    if (results.length >= 8) break;
  }

  if (results.length === 0) {
    return {
      ...empty,
      notes: [
        `No public discussion of ${companyName}'s interview process was found. The kit relies on the job description and the company site instead.`,
      ],
    };
  }

  const skipped: PublicDiscussion['skipped'] = [];
  const fetched: { url: string; title: string; text: string }[] = [];

  for (const result of results) {
    if (fetched.length >= maxPages) break;
    if (BLOCKED_HOSTS.some((h) => result.url.includes(h))) {
      skipped.push({ url: result.url, reason: 'Aggregator blocks automated access; snippet used instead' });
      if (result.snippet) fetched.push({ url: result.url, title: result.title, text: result.snippet });
      continue;
    }
    try {
      const page = await fetchPage(result.url, { timeoutMs: 10_000 });
      fetched.push({ url: page.url, title: page.title, text: page.text });
    } catch (error) {
      skipped.push({ url: result.url, reason: describe(error) });
      if (result.snippet) fetched.push({ url: result.url, title: result.title, text: result.snippet });
    }
  }

  if (fetched.length === 0) {
    return {
      ...empty,
      skipped,
      notes: [`Search returned results for ${companyName} but none could be retrieved.`],
    };
  }

  const output = await generateJson({
    label: 'public-discussion',
    system: [
      SAFETY_RULES,
      `You are assessing whether these web pages contain candidate-reported detail about interviewing at ${companyName}.`,
      'Set has_relevant_discussion=false if the pages are generic interview advice, a different company,',
      'or job listings. Report only what candidates actually describe. Do not generalise.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 1200,
    schema: ModelOutput,
    user: [
      ...fetched.map((p) =>
        dataBlock({ label: `web_page ${p.url}`, content: `${p.title}\n${p.text}`, maxChars: 4000 }),
      ),
      '',
      `Company: ${companyName}. Role: ${roleTitle || 'unspecified'}.`,
      'Return JSON: { "has_relevant_discussion": boolean, "summary": "string",',
      '  "themes": ["short phrases naming recurring stages, formats or topics"] }',
    ].join('\n'),
  });

  if (!output.has_relevant_discussion) {
    return {
      ...empty,
      skipped,
      notes: [
        `Search results for ${companyName} contained no candidate-reported interview detail; nothing was inferred from them.`,
      ],
    };
  }

  return {
    found: true,
    urls: fetched.map((p) => p.url),
    summary: output.summary.trim(),
    themes: output.themes,
    skipped,
    notes: [],
  };
}
