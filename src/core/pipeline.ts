import { extractRequirements } from './steps/extractRequirements';
import { crawlCompany, describe } from './steps/crawlCompany';
import { generateCompanyBrief } from './steps/companyBrief';
import { findHiringProcess } from './steps/findHiringProcess';
import { searchPublicDiscussion } from './steps/publicDiscussion';
import {
  generateQuestionsForCategory,
  generateQuestionsForGaps,
  type QuestionContext,
} from './steps/generateQuestions';
import { generateFlashcards } from './steps/generateFlashcards';
import { categoryForRequirement, checkCoverage } from './coverage';
import { allocateSchedule } from './schedule';
import { validateKit } from './validate';
import { LlmError } from './llm/provider';
import { truncate } from './text';
import { QUESTION_CATEGORIES, type Kit, type Question, type QuestionCategory, type Requirement } from './types';

/**
 * The pipeline is an explicit, resumable state machine rather than one long
 * function. Two reasons:
 *   1. Generation takes 60-120s. Serverless invocations do not. `advance` runs
 *      steps until its time budget is spent and hands the state back, so the
 *      same code drives a polling UI and a straight-through batch run.
 *   2. Each step's failure can be handled on its own terms — most degrade the
 *      kit and record why, only a few are fatal.
 */

export type StepName =
  | 'extract'
  | 'research.crawl'
  | 'research.brief'
  | 'research.hiring'
  | 'research.discussion'
  | 'questions.technical'
  | 'questions.behavioural'
  | 'questions.system-design'
  | 'questions.company-fit'
  | 'coverage'
  | 'coverage.gaps'
  | 'flashcards'
  | 'schedule'
  | 'finalise'
  | 'done';

export interface PipelineEvent {
  at: string;
  level: 'info' | 'warn' | 'error';
  step: StepName;
  message: string;
}

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
}

interface TrimmedPage {
  url: string;
  title: string;
  text: string;
}

export interface PipelineState {
  input: PipelineInput;
  status: 'running' | 'done' | 'failed';
  step: StepName;
  completed: StepName[];
  events: PipelineEvent[];
  passes: number;
  error: { code: string; message: string } | null;
  /** Page text is held only while the research steps need it, then dropped. */
  artifacts: { pages: TrimmedPage[] };
  kit: Kit;
}

/** Weighting for the progress bar; roughly proportional to wall-clock cost. */
const STEP_WEIGHTS: Record<StepName, number> = {
  extract: 10,
  'research.crawl': 14,
  'research.brief': 8,
  'research.hiring': 8,
  'research.discussion': 12,
  'questions.technical': 10,
  'questions.behavioural': 8,
  'questions.system-design': 8,
  'questions.company-fit': 8,
  coverage: 2,
  'coverage.gaps': 6,
  flashcards: 8,
  schedule: 1,
  finalise: 1,
  done: 0,
};

export const STEP_LABELS: Record<StepName, string> = {
  extract: 'Reading the job description',
  'research.crawl': 'Crawling the company site',
  'research.brief': 'Writing the company brief',
  'research.hiring': 'Looking for their hiring process',
  'research.discussion': 'Searching public interview discussion',
  'questions.technical': 'Writing technical questions',
  'questions.behavioural': 'Writing behavioural questions',
  'questions.system-design': 'Writing system design questions',
  'questions.company-fit': 'Writing company-fit questions',
  coverage: 'Checking requirement coverage',
  'coverage.gaps': 'Closing coverage gaps',
  flashcards: 'Building flashcards',
  schedule: 'Allocating the study schedule',
  finalise: 'Validating the kit',
  done: 'Complete',
};

/** Coverage passes are capped: three is enough to close a real gap, and a fourth
 *  has never been the difference between covered and not — it just burns tokens. */
const MAX_COVERAGE_PASSES = 3;
const MAX_GAP_REQUIREMENTS_PER_PASS = 12;

export function createInitialState(input: PipelineInput): PipelineState {
  const days = clampDays(input.days);
  return {
    input: { ...input, days },
    status: 'running',
    step: 'extract',
    completed: [],
    events: [],
    passes: 0,
    error: null,
    artifacts: { pages: [] },
    kit: emptyKit(input, days),
  };
}

export function clampDays(days: number): number {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n)) return 5;
  return Math.min(90, Math.max(1, n));
}

function emptyKit(input: PipelineInput, days: number): Kit {
  return {
    source: {
      company: '',
      company_url: input.companyUrl,
      role: '',
      location: '',
      jd_chars: (input.jd ?? '').length,
      researched_at: new Date().toISOString(),
      pages_used: [],
    },
    company_brief: { summary: '', what_they_do: '', sources: [], origin: 'generated', pinned: false },
    role: { title: '', seniority: '', responsibilities: [], requirements: [] },
    questions: [],
    flashcards: [],
    schedule: { days_available: days, days: [] },
    coverage: { uncovered_requirement_ids: [], passes: 0 },
    research: {
      crawled_pages: 0,
      hiring_process_found: false,
      hiring_process_urls: [],
      hiring_process_summary: '',
      public_discussion_found: false,
      public_discussion_urls: [],
      public_discussion_summary: '',
      skipped_sources: [],
      notes: [],
    },
  };
}

export function progressPercent(state: Pick<PipelineState, 'completed' | 'status'>): number {
  const total = Object.values(STEP_WEIGHTS).reduce((a, b) => a + b, 0);
  const done = state.completed.reduce((sum, s) => sum + (STEP_WEIGHTS[s] ?? 0), 0);
  return state.status === 'done' ? 100 : Math.min(99, Math.round((done / total) * 100));
}

class FatalStepError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AdvanceOptions {
  /** Stop starting new steps once this much time has been spent. */
  timeBudgetMs?: number;
  onEvent?: (event: PipelineEvent) => void;
}

/**
 * Runs steps until the kit is finished, a step is fatal, or the time budget is
 * spent. Always returns state that is safe to persist and resume from.
 */
export async function advance(state: PipelineState, opts: AdvanceOptions = {}): Promise<PipelineState> {
  const deadline = Date.now() + (opts.timeBudgetMs ?? 25_000);
  const log = (level: PipelineEvent['level'], message: string) => {
    const event: PipelineEvent = { at: new Date().toISOString(), level, step: state.step, message };
    state.events.push(event);
    // Keep the event log bounded; the UI only ever shows the tail.
    if (state.events.length > 200) state.events = state.events.slice(-200);
    opts.onEvent?.(event);
  };

  while (state.status === 'running' && state.step !== 'done') {
    const step = state.step;
    try {
      state.step = await runStep(step, state, log);
      if (!state.completed.includes(step)) state.completed.push(step);
    } catch (error) {
      if (error instanceof FatalStepError) {
        state.status = 'failed';
        state.error = { code: error.code, message: error.message };
        log('error', error.message);
        return state;
      }
      // Non-fatal: record it, note it in the kit, move on.
      const message = error instanceof Error ? error.message : String(error);
      log('warn', `${STEP_LABELS[step]} failed: ${message}`);
      state.kit.research!.notes.push(`${STEP_LABELS[step]} did not complete: ${message}`);
      state.step = nextAfterFailure(step, state);
      if (!state.completed.includes(step)) state.completed.push(step);
    }

    if (state.step === 'done') {
      state.status = 'done';
      break;
    }
    if (Date.now() >= deadline) break; // resume from state.step on the next call
  }

  return state;
}

/** Straight-through execution, used by the batch runner and tests. */
export async function runPipeline(
  input: PipelineInput,
  opts: { onEvent?: (e: PipelineEvent) => void; totalBudgetMs?: number } = {},
): Promise<PipelineState> {
  let state = createInitialState(input);
  const deadline = Date.now() + (opts.totalBudgetMs ?? 10 * 60_000);
  while (state.status === 'running' && Date.now() < deadline) {
    state = await advance(state, { timeBudgetMs: 60_000, onEvent: opts.onEvent });
  }
  if (state.status === 'running') {
    state.status = 'failed';
    state.error = { code: 'TIMEOUT', message: 'Pipeline exceeded its total time budget.' };
  }
  return state;
}

type Logger = (level: PipelineEvent['level'], message: string) => void;

async function runStep(step: StepName, state: PipelineState, log: Logger): Promise<StepName> {
  const kit = state.kit;

  switch (step) {
    case 'extract': {
      log('info', STEP_LABELS.extract);
      let extracted;
      try {
        extracted = await extractRequirements(state.input.jd);
      } catch (error) {
        // Without requirements there is no kit to build.
        throw new FatalStepError(
          error instanceof LlmError && error.code === 'NOT_CONFIGURED' ? 'LLM_NOT_CONFIGURED' : 'EXTRACTION_FAILED',
          `Could not extract requirements from the job description: ${describe(error)}`,
        );
      }
      kit.role = extracted.role;
      kit.source.role = extracted.role.title;
      kit.source.location = extracted.location;
      kit.source.company = extracted.companyName;
      kit.research!.notes.push(...extracted.notes);
      log('info', `Extracted ${extracted.role.requirements.length} requirements (${countMust(extracted.role.requirements)} must-have)`);
      return 'research.crawl';
    }

    case 'research.crawl': {
      log('info', `${STEP_LABELS['research.crawl']}: ${state.input.companyUrl}`);
      const result = await crawlCompany(state.input.companyUrl, {
        maxPages: Number(process.env.CRAWL_MAX_PAGES ?? 7),
        timeBudgetMs: 45_000,
        onProgress: (m) => log('info', m),
      });
      state.artifacts.pages = result.pages.map((p) => ({
        url: p.url,
        title: p.title,
        text: truncate(p.text, 9_000),
      }));
      kit.research!.crawled_pages = result.pages.length;
      kit.research!.skipped_sources.push(...result.skipped);
      kit.source.pages_used = result.pages.map((p) => p.url);

      if (result.pages.length === 0) {
        // Not fatal: a kit built from the job description alone is still a kit.
        kit.research!.notes.push(
          `The company site at ${state.input.companyUrl} could not be reached, so this kit is built from the job description alone.`,
        );
        log('warn', `No pages retrieved from ${state.input.companyUrl}`);
      } else {
        log('info', `Retrieved ${result.pages.length} pages, skipped ${result.skipped.length}`);
      }
      return 'research.brief';
    }

    case 'research.brief': {
      log('info', STEP_LABELS['research.brief']);
      const { brief, companyName, notes } = await generateCompanyBrief({
        pages: state.artifacts.pages as never,
        companyUrl: state.input.companyUrl,
        fallbackName: kit.source.company || hostOf(state.input.companyUrl),
      });
      kit.company_brief = brief;
      kit.source.company = kit.source.company || companyName;
      kit.research!.notes.push(...notes);
      return 'research.hiring';
    }

    case 'research.hiring': {
      log('info', STEP_LABELS['research.hiring']);
      const hiring = await findHiringProcess(state.artifacts.pages as never);
      kit.research!.hiring_process_found = hiring.found;
      kit.research!.hiring_process_urls = hiring.urls;
      kit.research!.hiring_process_summary = hiring.summary;
      state.artifacts.pages = []; // page text has served its purpose
      if (hiring.found) {
        log('info', `Hiring process found: ${hiring.urls.join(', ')}`);
        (state as PipelineState & { hiringStages?: unknown }).hiringStages = hiring.stages;
        kit.research!.notes.push(
          `Hiring process found at ${hiring.urls[0]} — questions are shaped for the stages it describes.`,
        );
      } else {
        log('warn', 'No hiring process page found on the company site');
        kit.research!.notes.push(
          'No page describing the hiring process was found on the company site; no interview format has been assumed.',
        );
      }
      return 'research.discussion';
    }

    case 'research.discussion': {
      log('info', STEP_LABELS['research.discussion']);
      const discussion = await searchPublicDiscussion({
        companyName: kit.source.company,
        roleTitle: kit.role.title,
        companyUrl: state.input.companyUrl,
      });
      kit.research!.public_discussion_found = discussion.found;
      kit.research!.public_discussion_urls = discussion.urls;
      kit.research!.public_discussion_summary = discussion.summary;
      kit.research!.skipped_sources.push(...discussion.skipped);
      kit.research!.notes.push(...discussion.notes);
      (state as PipelineState & { publicThemes?: string[] }).publicThemes = discussion.themes;
      kit.source.pages_used = [...new Set([...kit.source.pages_used, ...discussion.urls])];
      log(discussion.found ? 'info' : 'warn', discussion.found ? `Public discussion found (${discussion.urls.length} sources)` : 'No public interview discussion found');
      return 'questions.technical';
    }

    case 'questions.technical':
    case 'questions.behavioural':
    case 'questions.system-design':
    case 'questions.company-fit': {
      const category = step.slice('questions.'.length) as QuestionCategory;
      let routed = requirementsForCategory(kit.role.requirements, category);
      const next = nextCategoryStep(category);

      // If the company publishes a design round, the kit must have design
      // questions even when no requirement's wording routed itself there.
      // This is the clearest case of the hiring page changing the kit.
      if (category === 'system-design' && routed.length === 0 && publishesDesignRound(state)) {
        routed = kit.role.requirements
          .filter((r) => r.kind === 'technical' && r.priority === 'must')
          .slice(0, 4);
        if (routed.length > 0) {
          log('info', 'Their published process includes a design round; seeding design questions from the must-have technical requirements');
        }
      }

      if (routed.length === 0 && category !== 'company-fit') {
        log('info', `No requirements routed to ${category}; skipping`);
        return next;
      }
      log('info', STEP_LABELS[step]);
      const questions = await generateQuestionsForCategory({
        category,
        // company-fit is about the company, so it works from the whole requirement set.
        requirements: category === 'company-fit' ? kit.role.requirements.slice(0, 12) : routed,
        context: contextFor(state),
        count: questionCountFor(category, routed.length, kit.role.requirements.length),
        existingIds: kit.questions.map((q) => q.id),
      });
      kit.questions.push(...questions);
      log('info', `Added ${questions.length} ${category} questions`);
      return next;
    }

    case 'coverage': {
      const report = checkCoverage(kit.role.requirements, kit.questions);
      kit.coverage = {
        uncovered_requirement_ids: report.uncovered_requirement_ids,
        passes: state.passes,
      };
      if (report.unsupported_links.length) {
        log(
          'warn',
          `${report.unsupported_links.length} claimed requirement links were not supported by the question text and were not counted`,
        );
      }
      if (report.uncovered_requirement_ids.length === 0) {
        log('info', `Coverage complete after ${state.passes} pass${state.passes === 1 ? '' : 'es'}`);
        return 'flashcards';
      }
      if (state.passes >= MAX_COVERAGE_PASSES) {
        log('warn', `Stopping after ${state.passes} passes with ${report.uncovered_requirement_ids.length} requirement(s) still uncovered`);
        kit.research!.notes.push(
          `${report.uncovered_requirement_ids.length} requirement(s) could not be covered after ${state.passes} passes and are reported honestly in coverage.`,
        );
        return 'flashcards';
      }
      log('info', `${report.uncovered_requirement_ids.length} uncovered requirement(s); running a gap pass`);
      return 'coverage.gaps';
    }

    case 'coverage.gaps': {
      const before = kit.coverage.uncovered_requirement_ids.length;
      const byId = new Map(kit.role.requirements.map((r) => [r.id, r]));
      // Must-haves first: they are the ones that make or break the kit.
      const targets = kit.coverage.uncovered_requirement_ids
        .map((id) => byId.get(id))
        .filter((r): r is Requirement => Boolean(r))
        .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'must' ? -1 : 1))
        .slice(0, MAX_GAP_REQUIREMENTS_PER_PASS);

      const grouped = new Map<QuestionCategory, Requirement[]>();
      for (const req of targets) {
        const category = categoryForRequirement(req);
        grouped.set(category, [...(grouped.get(category) ?? []), req]);
      }

      state.passes += 1;
      for (const [category, requirements] of grouped) {
        try {
          const questions = await generateQuestionsForGaps({
            category,
            requirements,
            context: contextFor(state),
            existingIds: kit.questions.map((q) => q.id),
          });
          kit.questions.push(...questions);
          log('info', `Gap pass ${state.passes}: added ${questions.length} ${category} questions`);
        } catch (error) {
          log('warn', `Gap pass ${state.passes} failed for ${category}: ${describe(error)}`);
        }
      }

      const after = checkCoverage(kit.role.requirements, kit.questions).uncovered_requirement_ids.length;
      if (after >= before) {
        // No progress: another identical pass would not help either.
        log('warn', `Gap pass ${state.passes} closed nothing; stopping the loop`);
        kit.coverage.passes = state.passes;
        kit.research!.notes.push(
          'A coverage pass produced no new usable questions, so the loop was stopped rather than repeated.',
        );
        return 'flashcards';
      }
      return 'coverage';
    }

    case 'flashcards': {
      log('info', STEP_LABELS.flashcards);
      const cards = await generateFlashcards({
        requirements: kit.role.requirements,
        questions: kit.questions,
        roleTitle: kit.role.title,
        companyName: kit.source.company,
        count: flashcardCountFor(kit.role.requirements.length),
        existingIds: kit.flashcards.map((f) => f.id),
      });
      kit.flashcards.push(...cards);
      return 'schedule';
    }

    case 'schedule': {
      kit.schedule = allocateSchedule({
        questions: kit.questions,
        requirements: kit.role.requirements,
        days_available: state.input.days,
      });
      log('info', `Allocated ${kit.schedule.days.length} day(s)`);
      return 'finalise';
    }

    case 'finalise': {
      const report = checkCoverage(kit.role.requirements, kit.questions);
      kit.coverage = {
        uncovered_requirement_ids: report.uncovered_requirement_ids,
        passes: Math.max(1, state.passes),
      };
      kit.source.researched_at = new Date().toISOString();

      const validation = validateKit(kit);
      if (!validation.ok) {
        throw new FatalStepError('INVALID_KIT', `Generated kit failed validation: ${validation.errors.join('; ')}`);
      }
      if (kit.questions.length === 0 && kit.role.requirements.length > 0) {
        throw new FatalStepError(
          'NO_QUESTIONS',
          'Requirements were extracted but no questions could be generated (the model provider failed for every category).',
        );
      }
      log('info', 'Kit validated');
      return 'done';
    }

    default:
      return 'done';
  }
}

/** Where to go when a non-fatal step throws. */
function nextAfterFailure(step: StepName, state: PipelineState): StepName {
  const order: StepName[] = [
    'extract', 'research.crawl', 'research.brief', 'research.hiring', 'research.discussion',
    'questions.technical', 'questions.behavioural', 'questions.system-design', 'questions.company-fit',
    'coverage', 'coverage.gaps', 'flashcards', 'schedule', 'finalise', 'done',
  ];
  // A failed gap pass returns to the coverage check, which will stop the loop itself.
  if (step === 'coverage.gaps') {
    state.passes += 1;
    return 'coverage';
  }
  const index = order.indexOf(step);
  return order[Math.min(index + 1, order.length - 1)];
}

function nextCategoryStep(category: QuestionCategory): StepName {
  const index = QUESTION_CATEGORIES.indexOf(category);
  const next = QUESTION_CATEGORIES[index + 1];
  return next ? (`questions.${next}` as StepName) : 'coverage';
}

/** Routes a requirement to the category that should own it. Deterministic. */
export function requirementsForCategory(
  requirements: Requirement[],
  category: QuestionCategory,
): Requirement[] {
  return requirements.filter((r) => categoryForRequirement(r) === category);
}

/** Enough questions to cover the routed requirements with a little headroom, capped. */
export function questionCountFor(
  category: QuestionCategory,
  routedCount: number,
  totalRequirements: number,
): number {
  if (category === 'company-fit') return totalRequirements === 0 ? 2 : 4;
  if (routedCount === 0) return 0;
  return Math.min(8, Math.max(2, Math.ceil(routedCount * 1.2)));
}

export function flashcardCountFor(requirementCount: number): number {
  return Math.min(24, Math.max(4, requirementCount * 2));
}

function contextFor(state: PipelineState): QuestionContext {
  const kit = state.kit;
  return {
    roleTitle: kit.role.title,
    seniority: kit.role.seniority,
    companyName: kit.source.company,
    companySummary: kit.company_brief.summary,
    hiringProcessSummary: kit.research?.hiring_process_summary ?? '',
    hiringStages: ((state as PipelineState & { hiringStages?: { name: string; description: string }[] })
      .hiringStages ?? []),
    publicDiscussionSummary: kit.research?.public_discussion_summary ?? '',
    publicThemes: (state as PipelineState & { publicThemes?: string[] }).publicThemes ?? [],
  };
}

/** Does anything we retrieved say this company runs a design or architecture round? */
export function publishesDesignRound(state: PipelineState): boolean {
  const stages = (state as PipelineState & { hiringStages?: { name: string; description: string }[] })
    .hiringStages ?? [];
  const themes = (state as PipelineState & { publicThemes?: string[] }).publicThemes ?? [];
  const haystack = [
    state.kit.research?.hiring_process_summary ?? '',
    state.kit.research?.public_discussion_summary ?? '',
    ...stages.flatMap((s) => [s.name, s.description]),
    ...themes,
  ]
    .join(' ')
    .toLowerCase();

  return /system.?design|architect\w*\s+(interview|round|discussion|exercise)|design\s+(interview|round|discussion|exercise)/.test(
    haystack,
  );
}

function countMust(requirements: Requirement[]): number {
  return requirements.filter((r) => r.priority === 'must').length;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export type { Question };
