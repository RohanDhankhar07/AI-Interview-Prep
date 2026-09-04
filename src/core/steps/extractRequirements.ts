import { z } from 'zod';
import { generateJson } from '../llm/json';
import { dataBlock, SAFETY_RULES } from '../llm/prompts';
import { mintIds } from '../ids';
import { REQUIREMENT_KINDS, type Requirement, type Role } from '../types';

/**
 * Step 1. The job description is pasted text, so this step needs no retrieval at
 * all — it reads what is there and nothing more.
 *
 * Ids are minted here in code, not by the model, so they are stable and dense
 * (r1..rn) no matter what the model returns.
 */

const ModelRequirement = z.object({
  text: z.string().min(3).max(400),
  kind: z.enum(REQUIREMENT_KINDS).catch('technical'),
  priority: z.enum(['must', 'nice']).catch('must'),
  evidence: z.string().max(400).optional(),
});

const ModelOutput = z.object({
  title: z.string().max(200).default(''),
  seniority: z.string().max(80).default(''),
  location: z.string().max(120).default(''),
  company_name: z.string().max(160).default(''),
  responsibilities: z.array(z.string().min(3).max(400)).max(15).default([]),
  requirements: z.array(ModelRequirement).max(30).default([]),
  thin: z.boolean().default(false),
});

export interface ExtractedRole {
  role: Role;
  location: string;
  companyName: string;
  thin: boolean;
  notes: string[];
}

const SYSTEM = [
  SAFETY_RULES,
  'You extract structured hiring requirements from a job description.',
  'Rules that matter more than completeness:',
  '1. Extract ONLY what the posting states. Never add a requirement the text does not support.',
  '2. A short posting must yield few requirements. Returning three honest items beats inventing ten.',
  '3. priority "must" is for anything the posting frames as required, essential, or a stated',
  '   minimum ("5+ years of X", "requires", "you have"). priority "nice" is for anything framed as',
  '   preferred, bonus, a plus, desirable, or optional. Wording decides this, not your judgement of importance.',
  '4. kind: "technical" for tools, languages, systems and engineering practice; "behavioural" for',
  '   collaboration, communication, mentoring, ownership and ways of working; "domain" for industry,',
  '   business area, regulatory or product knowledge.',
  '5. One requirement per item. Split a sentence that bundles several distinct skills.',
  '6. "evidence" must quote the words from the posting that the requirement came from.',
].join('\n');

const SHAPE = `{
  "company_name": "string (only if the posting names it, else \\"\\")",
  "title": "string", "seniority": "e.g. junior|mid|senior|staff|lead (or \\"\\" if unstated)",
  "location": "string or \\"\\"",
  "responsibilities": ["string"],
  "requirements": [{ "text": "string", "kind": "technical|behavioural|domain",
                     "priority": "must|nice", "evidence": "quoted words from the posting" }],
  "thin": "true if the posting is too short or vague to extract much from"
}`;

export async function extractRequirements(jd: string): Promise<ExtractedRole> {
  const notes: string[] = [];
  const trimmed = (jd ?? '').trim();

  if (trimmed.length < 40) {
    // Nothing to work with. Say so rather than asking a model to fill the gap.
    notes.push(
      `The job description is only ${trimmed.length} characters. No requirements could be extracted from it.`,
    );
    return {
      role: { title: trimmed.split('\n')[0]?.slice(0, 120) || 'Unspecified role', seniority: '', responsibilities: [], requirements: [] },
      location: '',
      companyName: '',
      thin: true,
      notes,
    };
  }

  const output = await generateJson({
    label: 'extract-requirements',
    system: SYSTEM,
    temperature: 0.1,
    maxTokens: 2600,
    schema: ModelOutput,
    user: [
      dataBlock({ label: 'job_description', content: trimmed, maxChars: 18_000 }),
      '',
      'Extract the role and its requirements from the job description above.',
      `Return JSON matching exactly this shape:\n${SHAPE}`,
    ].join('\n'),
  });

  const requirements: Requirement[] = dedupe(output.requirements).map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text.trim(),
    kind: r.kind,
    priority: r.priority,
    origin: 'generated' as const,
    pinned: false,
  }));

  const thin = output.thin || requirements.length <= 2 || trimmed.length < 400;
  if (thin) {
    notes.push(
      `The job description is thin (${trimmed.length} characters, ${requirements.length} requirement${
        requirements.length === 1 ? '' : 's'
      } found). The kit is deliberately small rather than padded with invented requirements.`,
    );
  }

  return {
    role: {
      title: output.title.trim() || 'Unspecified role',
      seniority: output.seniority.trim(),
      responsibilities: output.responsibilities.map((s) => s.trim()).filter(Boolean),
      requirements,
    },
    location: output.location.trim(),
    companyName: output.company_name.trim(),
    thin,
    notes,
  };
}

/** Models repeat themselves across bullet lists; near-identical items are collapsed. */
function dedupe<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = item.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Ids must be re-minted whenever a requirement is added by hand, without disturbing existing ones. */
export function appendRequirement(
  existing: Requirement[],
  input: Pick<Requirement, 'text' | 'kind' | 'priority'>,
): Requirement {
  const [id] = mintIds('r', 1, existing.map((r) => r.id));
  return { id, ...input, origin: 'manual', pinned: true };
}
