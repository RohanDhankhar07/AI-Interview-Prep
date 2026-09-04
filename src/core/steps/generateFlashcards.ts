import { z } from 'zod';
import { generateJson, tolerantArray } from '../llm/json';
import { SAFETY_RULES } from '../llm/prompts';
import { mintIds } from '../ids';
import type { Flashcard, Question, Requirement } from '../types';

/**
 * Step 8. Flashcards are recall drills, not questions restated. They are derived
 * from the requirements and the questions already generated, so practice mode
 * exercises the same material the schedule allocates.
 */

const ModelCard = z.object({
  front: z.string().min(1).max(300),
  back: z.string().min(1).max(1200),
  requirement_ids: z.array(z.string()).default([]),
});

const ModelOutput = z.object({ flashcards: tolerantArray(ModelCard, 40).default([]) });

export interface GenerateFlashcardsInput {
  requirements: Requirement[];
  questions: Question[];
  roleTitle: string;
  companyName: string;
  count: number;
  existingIds: string[];
}

export async function generateFlashcards({
  requirements,
  questions,
  roleTitle,
  companyName,
  count,
  existingIds,
}: GenerateFlashcardsInput): Promise<Flashcard[]> {
  if (requirements.length === 0 || count <= 0) return [];

  const output = await generateJson({
    label: 'flashcards',
    system: [
      SAFETY_RULES,
      'You write flashcards for spaced-repetition practice before a job interview.',
      'A good card has one fact, definition, trade-off or crisp talking point on the back —',
      'something recallable in under thirty seconds. Never restate an interview question verbatim.',
      'Cover the must-have requirements first. Set requirement_ids from the supplied ids only.',
    ].join(' '),
    temperature: 0.35,
    maxTokens: 3000,
    schema: ModelOutput,
    user: [
      `Role: ${roleTitle}. Company: ${companyName || 'unknown'}.`,
      '',
      'Requirements:',
      ...requirements.map((r) => `- ${r.id} [${r.priority}] ${r.text}`),
      '',
      'Topics already covered by interview questions (build recall cards that support these):',
      ...questions.slice(0, 20).map((q) => `- ${q.prompt}`),
      '',
      `Write ${count} flashcards. Return JSON:`,
      '{ "flashcards": [{ "front": "string", "back": "string", "requirement_ids": ["r1"] }] }',
    ].join('\n'),
  });

  const valid = new Set(requirements.map((r) => r.id));
  const cards = output.flashcards.filter((c) => c.front.trim() && c.back.trim());
  const ids = mintIds('f', cards.length, existingIds);

  return cards.map((c, i) => ({
    id: ids[i],
    front: c.front.trim(),
    back: c.back.trim(),
    requirement_ids: [...new Set(c.requirement_ids)].filter((id) => valid.has(id)),
    origin: 'generated' as const,
    pinned: false,
  }));
}
