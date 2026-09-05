import { advance, createInitialState, clampDays, type PipelineState } from '../core/pipeline';
import { crawlCompany } from '../core/steps/crawlCompany';
import { generateCompanyBrief } from '../core/steps/companyBrief';
import { generateQuestionsForCategory, generateQuestionsForGaps } from '../core/steps/generateQuestions';
import { generateFlashcards } from '../core/steps/generateFlashcards';
import { categoryForRequirement, checkCoverage } from '../core/coverage';
import { allocateSchedule } from '../core/schedule';
import { mergeCompanyBrief, mergeFlashcards, mergeQuestions, pruneScheduleReferences } from '../core/merge';
import { validateKit } from '../core/validate';
import { caseFingerprint } from '../core/text';
import { questionCountFor, requirementsForCategory } from '../core/pipeline';
import type { Kit, QuestionCategory, Requirement } from '../core/types';
import { getRepositories, type KitRecord } from './repo';
import { ConflictError, NotFoundError } from './http';

/**
 * Application service: owns the lifecycle of a stored kit. Route handlers stay
 * thin, and the same operations are reachable from anywhere on the server.
 */

const LEASE_MS = 90_000;

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
  title?: string;
}

export interface CreateKitResult {
  record: KitRecord;
  duplicate: boolean;
}

/**
 * Submitting the same description and company twice returns the original kit
 * rather than paying for a second run. The fingerprint is content-based, so it
 * also catches a double-clicked submit button.
 */
export async function createKit(userId: string, input: CreateKitInput): Promise<CreateKitResult> {
  const { kits } = getRepositories();
  const fingerprint = caseFingerprint(input.jd, input.companyUrl);

  const existing = await kits.findByFingerprint(userId, fingerprint);
  if (existing) return { record: existing, duplicate: true };

  const state = createInitialState({
    jd: input.jd,
    companyUrl: input.companyUrl,
    days: clampDays(input.days),
  });
  const now = new Date().toISOString();

  try {
    const record = await kits.create({
      userId,
      title: input.title?.trim() || deriveTitle(input),
      fingerprint,
      input: state.input,
      status: state.status,
      step: state.step,
      completed: state.completed,
      passes: state.passes,
      error: state.error,
      events: state.events,
      artifacts: state.artifacts,
      context: state.context,
      kit: state.kit,
      leaseUntil: null,
      scheduleEdited: false,
      practice: {},
      createdAt: now,
      updatedAt: now,
    });
    return { record, duplicate: false };
  } catch (error) {
    // Lost a race against a concurrent identical submission; return the winner.
    if ((error as { code?: number }).code === 11000) {
      const winner = await kits.findByFingerprint(userId, fingerprint);
      if (winner) return { record: winner, duplicate: true };
    }
    throw error;
  }
}

function deriveTitle(input: CreateKitInput): string {
  const firstLine = input.jd.split('\n').find((l) => l.trim().length > 3)?.trim() ?? 'Untitled role';
  return firstLine.slice(0, 90);
}

export function toState(record: KitRecord): PipelineState {
  return {
    input: record.input,
    status: record.status,
    step: record.step,
    completed: record.completed,
    events: record.events,
    passes: record.passes,
    error: record.error,
    artifacts: record.artifacts,
    // Kits created before this field existed simply have no stored findings.
    context: record.context ?? { hiringStages: [], publicThemes: [] },
    kit: record.kit,
  };
}

/**
 * Runs the next slice of generation under a lease, so two browser tabs (or a
 * retried request) cannot advance the same kit at once. Whatever was completed
 * is persisted even when the slice ends mid-pipeline.
 */
export async function advanceKit(
  userId: string,
  kitId: string,
  timeBudgetMs = 25_000,
): Promise<KitRecord> {
  const { kits } = getRepositories();
  const current = await kits.findById(kitId, userId);
  if (!current) throw new NotFoundError('Kit not found.');
  if (current.status !== 'running') return current;

  const leased = await kits.acquireLease(kitId, userId, LEASE_MS);
  if (!leased) throw new ConflictError('This kit is already being generated.');

  try {
    const state = await advance(toState(leased), { timeBudgetMs });
    const updated = await kits.update(kitId, userId, {
      status: state.status,
      step: state.step,
      completed: state.completed,
      passes: state.passes,
      error: state.error,
      events: state.events,
      artifacts: state.artifacts,
      context: state.context,
      kit: state.kit,
      leaseUntil: null,
    });
    return updated ?? leased;
  } catch (error) {
    // A crash must not leave the kit locked out of future attempts.
    await kits.releaseLease(kitId, userId);
    throw error;
  }
}

export type RegenerableSection =
  | 'company_brief'
  | 'flashcards'
  | 'schedule'
  | `questions:${QuestionCategory}`;

export interface RegenerateResult {
  record: KitRecord;
  summary: string;
}

/**
 * Regenerates one section in place. Anything the user edited, wrote or pinned
 * survives — see src/core/merge for the rules — and no other section is touched.
 */
export async function regenerateSection(
  userId: string,
  kitId: string,
  section: RegenerableSection,
): Promise<RegenerateResult> {
  const { kits } = getRepositories();
  const leased = await kits.acquireLease(kitId, userId, LEASE_MS);
  if (!leased) {
    const exists = await kits.findById(kitId, userId);
    if (!exists) throw new NotFoundError('Kit not found.');
    throw new ConflictError('Another regeneration is already running for this kit.');
  }

  try {
    if (leased.status === 'running') throw new ConflictError('Wait for generation to finish first.');
    const kit: Kit = structuredClone(leased.kit);
    let summary = '';
    let scheduleEdited = leased.scheduleEdited ?? false;

    if (section === 'company_brief') {
      summary = await regenerateBrief(kit, leased);
    } else if (section === 'flashcards') {
      summary = await regenerateFlashcards(kit);
    } else if (section === 'schedule') {
      summary = regenerateSchedule(kit, leased);
      // Asking for a re-allocation replaces whatever was arranged by hand.
      scheduleEdited = false;
    } else {
      summary = await regenerateQuestionCategory(kit, section.split(':')[1] as QuestionCategory, leased);
    }

    finaliseKit(kit, leased);
    const validation = validateKit(kit);
    if (!validation.ok) {
      throw new ConflictError(`Regenerated section did not validate: ${validation.errors.join('; ')}`);
    }

    const record = await kits.update(kitId, userId, {
      kit: validation.kit!,
      leaseUntil: null,
      scheduleEdited,
    });
    return { record: record ?? leased, summary };
  } finally {
    await kits.releaseLease(kitId, userId);
  }
}

async function regenerateBrief(kit: Kit, record: KitRecord): Promise<string> {
  if (kit.company_brief.pinned) return 'The company brief is pinned, so it was left as it is.';
  // The brief is written from pages, and page text is not kept after generation,
  // so a fresh, smaller crawl is the honest way to rebuild it.
  const crawl = await crawlCompany(record.input.companyUrl, { maxPages: 4, timeBudgetMs: 25_000 });
  const { brief } = await generateCompanyBrief({
    pages: crawl.pages,
    companyUrl: record.input.companyUrl,
    fallbackName: kit.source.company,
  });
  const merged = mergeCompanyBrief(kit.company_brief, brief);
  kit.company_brief = merged.brief;
  kit.source.pages_used = [...new Set([...kit.source.pages_used, ...crawl.pages.map((p) => p.url)])];
  kit.research!.skipped_sources.push(...crawl.skipped);
  return `Rewrote the company brief from ${crawl.pages.length} freshly retrieved page(s).`;
}

async function regenerateFlashcards(kit: Kit): Promise<string> {
  const fresh = await generateFlashcards({
    requirements: kit.role.requirements,
    questions: kit.questions,
    roleTitle: kit.role.title,
    companyName: kit.source.company,
    count: Math.min(24, Math.max(4, kit.role.requirements.length * 2)),
    existingIds: kit.flashcards.map((f) => f.id),
  });
  const merged = mergeFlashcards(
    kit.flashcards,
    fresh.map(({ id: _id, ...rest }) => rest),
  );
  kit.flashcards = merged.items;
  return `Kept ${merged.kept} card(s) you had touched, replaced ${merged.replaced}, added ${merged.added}.`;
}

function regenerateSchedule(kit: Kit, record: KitRecord): string {
  kit.schedule = allocateSchedule({
    questions: kit.questions,
    requirements: kit.role.requirements,
    days_available: kit.schedule.days_available || record.input.days,
    confidenceByQuestionId: practiceConfidenceByQuestion(kit, record),
  });
  return `Re-allocated ${kit.schedule.days.length} day(s) across ${kit.questions.length} question(s).`;
}

async function regenerateQuestionCategory(
  kit: Kit,
  category: QuestionCategory,
  record: KitRecord,
): Promise<string> {
  const routed =
    category === 'company-fit'
      ? kit.role.requirements.slice(0, 12)
      : requirementsForCategory(kit.role.requirements, category);

  const fresh = await generateQuestionsForCategory({
    category,
    requirements: routed,
    context: contextFromKit(kit, record),
    count: questionCountFor(category, routed.length, kit.role.requirements.length),
    existingIds: kit.questions.map((q) => q.id),
  });

  const merged = mergeQuestions(
    kit.questions,
    fresh.map(({ id: _id, ...rest }) => rest),
    category,
  );
  kit.questions = merged.items;

  // Regenerating a category can open a coverage hole; close it before saving.
  const gaps = checkCoverage(kit.role.requirements, kit.questions).uncovered_must_ids
    .map((id) => kit.role.requirements.find((r) => r.id === id))
    .filter((r): r is Requirement => Boolean(r) && categoryForRequirement(r!) === category);

  let closed = 0;
  if (gaps.length) {
    const extra = await generateQuestionsForGaps({
      category,
      requirements: gaps,
      context: contextFromKit(kit, record),
      existingIds: kit.questions.map((q) => q.id),
    });
    kit.questions.push(...extra);
    closed = extra.length;
  }

  // The schedule is derived from the questions, so it has to follow them — unless
  // the user has arranged their days by hand, in which case we leave their work
  // alone and say the schedule is now out of date.
  let scheduleNote = '';
  if (record.scheduleEdited) {
    scheduleNote = 'Your hand-arranged schedule was left untouched, so it does not include the new questions yet';
  } else {
    kit.schedule = allocateSchedule({
      questions: kit.questions,
      requirements: kit.role.requirements,
      days_available: kit.schedule.days_available,
      confidenceByQuestionId: practiceConfidenceByQuestion(kit, record),
    });
    scheduleNote = 'and the schedule was re-allocated to include them';
  }

  return [
    `Kept ${merged.kept} question(s) you had edited or pinned`,
    `replaced ${merged.replaced}`,
    `added ${merged.added}`,
    closed ? `wrote ${closed} more to close a coverage gap` : '',
    scheduleNote,
  ]
    .filter(Boolean)
    .join(', ')
    .concat('.');
}

/**
 * Rebuilds the prompt context for a regeneration. The stored research findings
 * are used, so a regenerated category is shaped by the company's published
 * interview stages exactly as the first pass was.
 */
export function contextFromKit(kit: Kit, record?: KitRecord) {
  return {
    roleTitle: kit.role.title,
    seniority: kit.role.seniority,
    companyName: kit.source.company,
    companySummary: kit.company_brief.summary,
    hiringProcessSummary: kit.research?.hiring_process_summary ?? '',
    hiringStages: record?.context?.hiringStages ?? [],
    publicDiscussionSummary: kit.research?.public_discussion_summary ?? '',
    publicThemes: record?.context?.publicThemes ?? [],
  };
}

/** Recomputes everything the code owns: coverage, dangling references, timestamps. */
export function finaliseKit(kit: Kit, record?: KitRecord): void {
  pruneScheduleReferences(kit);
  const report = checkCoverage(kit.role.requirements, kit.questions);
  kit.coverage = {
    uncovered_requirement_ids: report.uncovered_requirement_ids,
    passes: kit.coverage.passes,
  };
  if (record && kit.schedule.days.length !== kit.schedule.days_available) {
    kit.schedule = allocateSchedule({
      questions: kit.questions,
      requirements: kit.role.requirements,
      days_available: kit.schedule.days_available,
      confidenceByQuestionId: practiceConfidenceByQuestion(kit, record),
    });
  }
}

/**
 * Practice happens on flashcards, but the schedule allocates questions. Cards and
 * questions meet at the requirement, so a card the user found hard lowers the
 * confidence of every question covering the same requirement.
 */
export function practiceConfidenceByQuestion(kit: Kit, record: KitRecord): Record<string, number> {
  const byRequirement = new Map<string, number[]>();
  for (const card of kit.flashcards) {
    const practice = record.practice?.[card.id];
    if (!practice) continue;
    for (const rid of card.requirement_ids) {
      byRequirement.set(rid, [...(byRequirement.get(rid) ?? []), practice.confidence]);
    }
  }
  const result: Record<string, number> = {};
  for (const question of kit.questions) {
    const scores = question.requirement_ids.flatMap((rid) => byRequirement.get(rid) ?? []);
    if (scores.length) result[question.id] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }
  return result;
}
