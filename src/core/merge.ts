import { mintIds } from './ids';
import type { CompanyBrief, Flashcard, Kit, Question, QuestionCategory } from './types';

/**
 * Regeneration merge rules — the hardest state problem in the app.
 *
 * Each item carries `origin` and `pinned`, and regeneration is scoped to one
 * section. Within that section:
 *   - `generated` + not pinned  -> replaced by the new draft
 *   - `edited`, `manual`, or pinned -> kept, and the new draft is appended around it
 * Anything outside the regenerated section is never touched, so regenerating the
 * technical questions cannot disturb a behavioural question, the brief, or a card.
 *
 * Ids are stable: kept items keep their ids and new items are minted against the
 * ids already in use across the whole kit, so schedule references stay valid.
 */

export function isProtected(item: { origin?: string; pinned?: boolean }): boolean {
  return item.pinned === true || item.origin === 'edited' || item.origin === 'manual';
}

export interface MergeResult<T> {
  items: T[];
  kept: number;
  replaced: number;
  added: number;
}

export function mergeQuestions(
  existing: Question[],
  fresh: Omit<Question, 'id'>[],
  category: QuestionCategory,
): MergeResult<Question> {
  const untouched = existing.filter((q) => q.category !== category);
  const inSection = existing.filter((q) => q.category === category);
  const keep = inSection.filter(isProtected);
  const replaced = inSection.length - keep.length;

  const ids = mintIds(
    'q',
    fresh.length,
    [...untouched, ...keep].map((q) => q.id),
  );
  const added = fresh.map((q, i) => ({ ...q, id: ids[i], origin: 'generated' as const, pinned: false }));

  // Survivors keep their positions; the new draft lands directly after the last
  // of them, so a pinned question does not suddenly jump to the bottom.
  const lastSurvivor = keep.at(-1) ?? inSection.at(-1);
  const merged: Question[] = [];
  for (const q of existing) {
    if (q.category !== category || keep.includes(q)) merged.push(q);
    if (q === lastSurvivor) merged.push(...added);
  }
  if (inSection.length === 0) merged.push(...added);

  return { items: dedupeById(merged), kept: keep.length, replaced, added: added.length };
}

export function mergeFlashcards(existing: Flashcard[], fresh: Omit<Flashcard, 'id'>[]): MergeResult<Flashcard> {
  const keep = existing.filter(isProtected);
  const ids = mintIds('f', fresh.length, keep.map((f) => f.id));
  const added = fresh.map((f, i) => ({ ...f, id: ids[i], origin: 'generated' as const, pinned: false }));
  return {
    items: [...keep, ...added],
    kept: keep.length,
    replaced: existing.length - keep.length,
    added: added.length,
  };
}

export function mergeCompanyBrief(
  existing: CompanyBrief,
  fresh: Omit<CompanyBrief, 'origin' | 'pinned'>,
): { brief: CompanyBrief; kept: boolean } {
  // A pinned brief is never overwritten, even by an explicit regeneration.
  if (existing.pinned) return { brief: existing, kept: true };
  return { brief: { ...fresh, origin: 'generated', pinned: false }, kept: false };
}

/** Marks an item as user-edited so future regenerations preserve it. */
export function markEdited<T extends { origin?: string }>(item: T, patch: Partial<T>): T {
  return { ...item, ...patch, origin: 'edited' } as T;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/**
 * After any structural change, the schedule may reference questions that no
 * longer exist. Rather than silently dropping ids we prune them and report.
 */
export function pruneScheduleReferences(kit: Kit): { removed: number } {
  const valid = new Set(kit.questions.map((q) => q.id));
  let removed = 0;
  for (const day of kit.schedule.days) {
    const before = day.question_ids.length;
    day.question_ids = day.question_ids.filter((id) => valid.has(id));
    removed += before - day.question_ids.length;
  }
  return { removed };
}
