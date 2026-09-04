import { KitSchema, type Kit } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  kit?: Kit;
}

/**
 * Structural validation runs before anything is persisted or written to the
 * batch output: shape first (zod), then referential integrity, which zod cannot
 * express — ids must be unique and every reference must resolve.
 */
export function validateKit(input: unknown): ValidationResult {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const kit = parsed.data;
  const errors = integrityErrors(kit);
  return errors.length ? { ok: false, errors, kit } : { ok: true, errors: [], kit };
}

export function integrityErrors(kit: Kit): string[] {
  const errors: string[] = [];

  const reqIds = new Set<string>();
  for (const r of kit.role.requirements) {
    if (reqIds.has(r.id)) errors.push(`duplicate requirement id: ${r.id}`);
    reqIds.add(r.id);
  }

  const questionIds = new Set<string>();
  for (const q of kit.questions) {
    if (questionIds.has(q.id)) errors.push(`duplicate question id: ${q.id}`);
    questionIds.add(q.id);
    for (const rid of q.requirement_ids) {
      if (!reqIds.has(rid)) errors.push(`question ${q.id} references unknown requirement ${rid}`);
    }
  }

  const cardIds = new Set<string>();
  for (const f of kit.flashcards) {
    if (cardIds.has(f.id)) errors.push(`duplicate flashcard id: ${f.id}`);
    cardIds.add(f.id);
    for (const rid of f.requirement_ids) {
      if (!reqIds.has(rid)) errors.push(`flashcard ${f.id} references unknown requirement ${rid}`);
    }
  }

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    errors.push(
      `schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`,
    );
  }
  const seenDayNumbers = new Set<number>();
  for (const d of kit.schedule.days) {
    if (seenDayNumbers.has(d.day)) errors.push(`duplicate schedule day: ${d.day}`);
    seenDayNumbers.add(d.day);
    if (!Number.isInteger(d.minutes)) errors.push(`day ${d.day} minutes must be an integer`);
    for (const qid of d.question_ids) {
      if (!questionIds.has(qid)) errors.push(`schedule day ${d.day} references unknown question ${qid}`);
    }
  }

  for (const rid of kit.coverage.uncovered_requirement_ids) {
    if (!reqIds.has(rid)) errors.push(`coverage references unknown requirement ${rid}`);
  }

  return errors;
}

/** Every must-have requirement carries at least one question. The core promise of the kit. */
export function uncoveredMustHaves(kit: Kit): string[] {
  const linked = new Set(kit.questions.flatMap((q) => q.requirement_ids));
  return kit.role.requirements.filter((r) => r.priority === 'must' && !linked.has(r.id)).map((r) => r.id);
}
