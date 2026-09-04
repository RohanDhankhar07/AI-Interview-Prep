import { z } from 'zod';
import { mintIds } from './ids';
import { checkCoverage } from './coverage';
import { pruneScheduleReferences } from './merge';
import {
  QUESTION_CATEGORIES,
  REQUIREMENT_KINDS,
  type Flashcard,
  type Kit,
  type Question,
} from './types';

/**
 * Every builder edit is one of these operations, applied to a whole kit and
 * validated before it is saved. Keeping them here — pure, framework-free —
 * means the same rules apply however the edit arrives.
 *
 * Editing an item flips its origin to `edited`, which is what protects it from
 * the next regeneration of its section.
 */

const QuestionPatch = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  answer_outline: z.string().max(8000).optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  requirement_ids: z.array(z.string()).max(20).optional(),
});

const FlashcardPatch = z.object({
  front: z.string().min(1).max(1000).optional(),
  back: z.string().max(4000).optional(),
  requirement_ids: z.array(z.string()).max(20).optional(),
});

export const OperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('question.update'), id: z.string(), patch: QuestionPatch }),
  z.object({ type: z.literal('question.reorder'), ids: z.array(z.string()).max(200) }),
  z.object({
    type: z.literal('question.move'),
    id: z.string(),
    category: z.enum(QUESTION_CATEGORIES),
  }),
  z.object({
    type: z.literal('question.add'),
    question: z.object({
      prompt: z.string().min(1).max(2000),
      answer_outline: z.string().max(8000).default(''),
      category: z.enum(QUESTION_CATEGORIES),
      difficulty: z.number().int().min(1).max(3).default(2),
      requirement_ids: z.array(z.string()).max(20).default([]),
    }),
  }),
  z.object({ type: z.literal('question.delete'), id: z.string() }),
  z.object({ type: z.literal('question.pin'), id: z.string(), pinned: z.boolean() }),

  z.object({ type: z.literal('flashcard.update'), id: z.string(), patch: FlashcardPatch }),
  z.object({
    type: z.literal('flashcard.add'),
    flashcard: z.object({
      front: z.string().min(1).max(1000),
      back: z.string().max(4000).default(''),
      requirement_ids: z.array(z.string()).max(20).default([]),
    }),
  }),
  z.object({ type: z.literal('flashcard.delete'), id: z.string() }),
  z.object({ type: z.literal('flashcard.pin'), id: z.string(), pinned: z.boolean() }),
  z.object({ type: z.literal('flashcard.reorder'), ids: z.array(z.string()).max(400) }),

  z.object({
    type: z.literal('brief.update'),
    patch: z.object({
      summary: z.string().max(4000).optional(),
      what_they_do: z.string().max(8000).optional(),
    }),
  }),
  z.object({ type: z.literal('brief.pin'), pinned: z.boolean() }),

  z.object({
    type: z.literal('requirement.update'),
    id: z.string(),
    patch: z.object({
      text: z.string().min(1).max(600).optional(),
      kind: z.enum(REQUIREMENT_KINDS).optional(),
      priority: z.enum(['must', 'nice']).optional(),
    }),
  }),
  z.object({
    type: z.literal('requirement.add'),
    requirement: z.object({
      text: z.string().min(1).max(600),
      kind: z.enum(REQUIREMENT_KINDS).default('technical'),
      priority: z.enum(['must', 'nice']).default('must'),
    }),
  }),
  z.object({ type: z.literal('requirement.delete'), id: z.string() }),

  z.object({
    type: z.literal('schedule.day.update'),
    day: z.number().int().positive(),
    patch: z.object({
      focus: z.string().max(300).optional(),
      minutes: z.number().int().min(0).max(1440).optional(),
      question_ids: z.array(z.string()).max(200).optional(),
    }),
  }),
]);

export type Operation = z.infer<typeof OperationSchema>;

export class MutationError extends Error {}

/** Applies one operation to a clone of the kit and returns the new kit. */
export function applyOperation(input: Kit, operation: Operation): Kit {
  const kit: Kit = structuredClone(input);

  switch (operation.type) {
    case 'question.update': {
      const question = find(kit.questions, operation.id, 'question');
      Object.assign(question, cleanPatch(operation.patch), { origin: 'edited' });
      validateRequirementRefs(kit, question.requirement_ids);
      break;
    }
    case 'question.reorder': {
      kit.questions = reorder(kit.questions, operation.ids, 'question');
      break;
    }
    case 'question.move': {
      const question = find(kit.questions, operation.id, 'question');
      // Moving a question across categories is a user decision, so it is an edit:
      // the next regeneration of either category must not undo it.
      question.category = operation.category;
      question.origin = 'edited';
      break;
    }
    case 'question.add': {
      const [id] = mintIds('q', 1, kit.questions.map((q) => q.id));
      const question: Question = {
        id,
        ...operation.question,
        origin: 'manual',
        pinned: true,
        difficulty: operation.question.difficulty as 1 | 2 | 3,
      };
      validateRequirementRefs(kit, question.requirement_ids);
      kit.questions.push(question);
      break;
    }
    case 'question.delete': {
      find(kit.questions, operation.id, 'question');
      kit.questions = kit.questions.filter((q) => q.id !== operation.id);
      break;
    }
    case 'question.pin': {
      find(kit.questions, operation.id, 'question').pinned = operation.pinned;
      break;
    }

    case 'flashcard.update': {
      const card = find(kit.flashcards, operation.id, 'flashcard');
      Object.assign(card, cleanPatch(operation.patch), { origin: 'edited' });
      validateRequirementRefs(kit, card.requirement_ids);
      break;
    }
    case 'flashcard.add': {
      const [id] = mintIds('f', 1, kit.flashcards.map((f) => f.id));
      const card: Flashcard = { id, ...operation.flashcard, origin: 'manual', pinned: true };
      validateRequirementRefs(kit, card.requirement_ids);
      kit.flashcards.push(card);
      break;
    }
    case 'flashcard.delete': {
      find(kit.flashcards, operation.id, 'flashcard');
      kit.flashcards = kit.flashcards.filter((f) => f.id !== operation.id);
      break;
    }
    case 'flashcard.pin': {
      find(kit.flashcards, operation.id, 'flashcard').pinned = operation.pinned;
      break;
    }
    case 'flashcard.reorder': {
      kit.flashcards = reorder(kit.flashcards, operation.ids, 'flashcard');
      break;
    }

    case 'brief.update': {
      Object.assign(kit.company_brief, cleanPatch(operation.patch), { origin: 'edited' });
      break;
    }
    case 'brief.pin': {
      kit.company_brief.pinned = operation.pinned;
      break;
    }

    case 'requirement.update': {
      const requirement = find(kit.role.requirements, operation.id, 'requirement');
      Object.assign(requirement, cleanPatch(operation.patch), { origin: 'edited' });
      break;
    }
    case 'requirement.add': {
      const [id] = mintIds('r', 1, kit.role.requirements.map((r) => r.id));
      kit.role.requirements.push({ id, ...operation.requirement, origin: 'manual', pinned: true });
      break;
    }
    case 'requirement.delete': {
      find(kit.role.requirements, operation.id, 'requirement');
      kit.role.requirements = kit.role.requirements.filter((r) => r.id !== operation.id);
      // Dangling references would fail validation, so they are cleared here.
      for (const q of kit.questions) {
        q.requirement_ids = q.requirement_ids.filter((id) => id !== operation.id);
      }
      for (const f of kit.flashcards) {
        f.requirement_ids = f.requirement_ids.filter((id) => id !== operation.id);
      }
      break;
    }

    case 'schedule.day.update': {
      const day = kit.schedule.days.find((d) => d.day === operation.day);
      if (!day) throw new MutationError(`No day ${operation.day} in this schedule.`);
      if (operation.patch.question_ids) {
        const valid = new Set(kit.questions.map((q) => q.id));
        const unknown = operation.patch.question_ids.filter((id) => !valid.has(id));
        if (unknown.length) throw new MutationError(`Unknown question(s): ${unknown.join(', ')}`);
      }
      Object.assign(day, cleanPatch(operation.patch));
      break;
    }
  }

  // Coverage and schedule integrity are recomputed after every edit: they are
  // derived facts, never something the client sends us.
  pruneScheduleReferences(kit);
  const report = checkCoverage(kit.role.requirements, kit.questions);
  kit.coverage = { ...kit.coverage, uncovered_requirement_ids: report.uncovered_requirement_ids };
  return kit;
}

export function applyOperations(kit: Kit, operations: Operation[]): Kit {
  return operations.reduce(applyOperation, kit);
}

function find<T extends { id: string }>(items: T[], id: string, label: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw new MutationError(`No ${label} with id ${id}.`);
  return found;
}

/** Reordering may only permute what is already there — no additions, no losses. */
function reorder<T extends { id: string }>(items: T[], ids: string[], label: string): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) throw new MutationError(`No ${label} with id ${id}.`);
    if (seen.has(id)) throw new MutationError(`Duplicate ${label} id in new order: ${id}.`);
    seen.add(id);
    ordered.push(item);
  }
  // Anything the client did not mention keeps its relative position at the end.
  return [...ordered, ...items.filter((item) => !seen.has(item.id))];
}

function cleanPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function validateRequirementRefs(kit: Kit, ids: string[]): void {
  const valid = new Set(kit.role.requirements.map((r) => r.id));
  const unknown = ids.filter((id) => !valid.has(id));
  if (unknown.length) throw new MutationError(`Unknown requirement(s): ${unknown.join(', ')}`);
}
