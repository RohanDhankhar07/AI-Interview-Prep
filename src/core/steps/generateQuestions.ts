import { z } from 'zod';
import { generateJson, tolerantArray } from '../llm/json';
import { dataBlock, SAFETY_RULES } from '../llm/prompts';
import { mintIds } from '../ids';
import { QUESTION_CATEGORIES, type Question, type QuestionCategory, type Requirement } from '../types';

/**
 * Step 7. Questions are generated per category, in separate calls with separate
 * instructions. "5+ years of React" and "mentor junior engineers" produce very
 * different interviews, and asking one prompt for both yields four variations of
 * the same question.
 *
 * What the company publishes about its process changes this step too: a company
 * with a documented take-home and a design round gets questions shaped for those
 * rounds; a company that publishes nothing gets no invented rounds.
 */

export interface QuestionContext {
  roleTitle: string;
  seniority: string;
  companyName: string;
  companySummary: string;
  hiringProcessSummary: string;
  hiringStages: { name: string; description: string }[];
  publicDiscussionSummary: string;
  publicThemes: string[];
}

const ModelQuestion = z.object({
  requirement_ids: z.array(z.string()).default([]),
  prompt: z.string().min(4).max(600),
  answer_outline: z.string().max(2500).default(''),
  difficulty: z.coerce.number().int().min(1).max(3).catch(2),
});

// One unusable question must not cost us the rest of the category.
const ModelOutput = z.object({ questions: tolerantArray(ModelQuestion, 20).default([]) });

/** Per-category instructions. This is where the categories stop being interchangeable. */
const CATEGORY_BRIEFS: Record<QuestionCategory, string> = {
  technical: [
    'Write technical interview questions that probe hands-on depth in the named tools and practices.',
    'Prefer questions that expose whether someone has actually used the thing: trade-offs they hit,',
    'failure modes they debugged, choices they would make differently. Avoid definition questions',
    '("what is a closure") unless the posting is genuinely junior.',
    'answer_outline: 3-6 bullet points naming what a strong answer covers, not a scripted answer.',
  ].join(' '),
  behavioural: [
    'Write behavioural questions in the "tell me about a time" family, each aimed at one requirement',
    'about collaboration, ownership, mentoring, conflict, communication or ways of working.',
    'answer_outline: coach the candidate on structuring a real story (situation, their specific',
    'actions, measurable outcome, what they learned) and name the signal the interviewer is listening for.',
  ].join(' '),
  'system-design': [
    'Write open-ended design questions scoped to the seniority in the posting and to the systems it',
    'names. Each should have room for requirements-gathering, a component sketch, a data model, and a',
    'discussion of scale, failure and trade-offs.',
    'answer_outline: the axes a strong candidate should cover, plus the follow-ups a good interviewer asks.',
  ].join(' '),
  'company-fit': [
    'Write questions that only make sense for this specific company and this posting: its product, its',
    'customers, its domain, and its stated way of working. Include at least one question the candidate',
    'should ask the interviewer.',
    'Do NOT write technical deep-dive, coding or architecture questions here — those belong to the other',
    'sections and are being generated separately. If a question would work unchanged at any other company,',
    'it does not belong in this section.',
    'Use only facts from the supplied company research. If the research is empty, write fewer questions',
    'and keep them anchored to the job description rather than inventing company detail.',
  ].join(' '),
};

function systemFor(category: QuestionCategory): string {
  return [
    SAFETY_RULES,
    `You are an experienced interviewer preparing the "${category}" section of a candidate's prep kit.`,
    CATEGORY_BRIEFS[category],
    'Every question must set requirement_ids to the ids of the requirements it genuinely tests, chosen',
    'only from the ids supplied. Do not claim a requirement the question does not actually exercise.',
    'difficulty: 1 warm-up, 2 standard, 3 the hardest a candidate at this level should expect.',
  ].join('\n');
}

function contextBlock(context: QuestionContext): string {
  const lines = [
    `Role: ${context.roleTitle}${context.seniority ? ` (${context.seniority})` : ''}`,
    `Company: ${context.companyName || 'unknown'}`,
  ];
  if (context.companySummary) lines.push(`What the company does: ${context.companySummary}`);
  if (context.hiringProcessSummary) {
    lines.push(`The company documents this hiring process: ${context.hiringProcessSummary}`);
  }
  if (context.hiringStages.length) {
    lines.push('This company publishes the rounds a candidate will actually face:');
    for (const stage of context.hiringStages) {
      lines.push(`  - ${stage.name}: ${stage.description}`);
    }
    lines.push(
      'Write for these rounds specifically. Where a question belongs to a named round, say so in',
      'the answer outline (for example "asked in the take-home debrief"). If a round rules something',
      'out — no live coding, no algorithm puzzles — respect that rather than writing it anyway.',
    );
  }
  if (context.publicDiscussionSummary) {
    lines.push(`Candidates publicly report: ${context.publicDiscussionSummary}`);
  }
  if (context.publicThemes.length) lines.push(`Recurring themes: ${context.publicThemes.join(', ')}`);
  if (!context.hiringProcessSummary && !context.publicDiscussionSummary) {
    lines.push(
      'No hiring process was found for this company. Do not invent one; base the questions on the role alone.',
    );
  }
  return lines.join('\n');
}

function requirementList(requirements: Requirement[]): string {
  return requirements
    .map((r) => `- ${r.id} [${r.priority}/${r.kind}] ${r.text}`)
    .join('\n');
}

export interface GenerateQuestionsInput {
  category: QuestionCategory;
  requirements: Requirement[];
  context: QuestionContext;
  count: number;
  existingIds: string[];
}

export async function generateQuestionsForCategory({
  category,
  requirements,
  context,
  count,
  existingIds,
}: GenerateQuestionsInput): Promise<Question[]> {
  if (requirements.length === 0 || count <= 0) return [];

  const output = await generateJson({
    label: `questions-${category}`,
    system: systemFor(category),
    temperature: 0.4,
    maxTokens: 3000,
    schema: ModelOutput,
    user: [
      contextBlock(context),
      '',
      'Requirements this section must cover (use these ids verbatim):',
      requirementList(requirements),
      '',
      `Write ${count} ${category} questions. Every requirement id listed above must be covered by at`,
      'least one question. Return JSON:',
      '{ "questions": [{ "requirement_ids": ["r1"], "prompt": "string",',
      '  "answer_outline": "string", "difficulty": 1 }] }',
    ].join('\n'),
  });

  return toQuestions(output.questions, category, requirements, existingIds);
}

/**
 * Second-pass generation: one question per still-uncovered requirement, with the
 * requirement text quoted so the resulting question shares its vocabulary and
 * the coverage checker can verify the link rather than take it on trust.
 */
export async function generateQuestionsForGaps({
  category,
  requirements,
  context,
  existingIds,
}: Omit<GenerateQuestionsInput, 'count'>): Promise<Question[]> {
  if (requirements.length === 0) return [];

  const output = await generateJson({
    label: `gap-questions-${category}`,
    system: [
      systemFor(category),
      'This is a gap-closing pass. Exactly one question per requirement, in the order given.',
      'Each question must use the requirement\'s own vocabulary so the link between them is obvious.',
    ].join('\n'),
    temperature: 0.35,
    maxTokens: 2600,
    schema: ModelOutput,
    user: [
      contextBlock(context),
      '',
      'These requirements currently have no question against them. Write exactly one question for each,',
      'setting requirement_ids to that single id:',
      requirementList(requirements),
      '',
      'Return JSON: { "questions": [{ "requirement_ids": ["r1"], "prompt": "string",',
      '  "answer_outline": "string", "difficulty": 2 }] }',
    ].join('\n'),
  });

  return toQuestions(output.questions, category, requirements, existingIds);
}

/** Ids are minted here; model-supplied requirement links are filtered to ones that exist. */
function toQuestions(
  raw: z.infer<typeof ModelQuestion>[],
  category: QuestionCategory,
  requirements: Requirement[],
  existingIds: string[],
): Question[] {
  const valid = new Set(requirements.map((r) => r.id));
  const cleaned = raw.filter((q) => q.prompt.trim().length > 0);
  const ids = mintIds('q', cleaned.length, existingIds);

  return cleaned.map((q, i) => ({
    id: ids[i],
    requirement_ids: [...new Set(q.requirement_ids)].filter((id) => valid.has(id)),
    category: QUESTION_CATEGORIES.includes(category) ? category : 'technical',
    prompt: q.prompt.trim(),
    answer_outline: q.answer_outline.trim(),
    difficulty: Math.min(3, Math.max(1, Math.round(q.difficulty))) as 1 | 2 | 3,
    origin: 'generated' as const,
    pinned: false,
  }));
}
