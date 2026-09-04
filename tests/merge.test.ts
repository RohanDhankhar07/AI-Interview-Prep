import { describe, expect, it } from 'vitest';
import { mergeQuestions, mergeFlashcards, mergeCompanyBrief, pruneScheduleReferences } from '../src/core/merge';
import { card, kit, question } from './helpers';
import type { Question } from '../src/core/types';

const draft = (prompt: string): Omit<Question, 'id'> => ({
  requirement_ids: ['r1'],
  category: 'technical',
  prompt,
  answer_outline: '',
  difficulty: 2,
  origin: 'generated',
  pinned: false,
});

describe('mergeQuestions', () => {
  it('replaces untouched generated questions in the regenerated category', () => {
    const existing = [question('q1', ['r1']), question('q2', ['r1'])];
    const result = mergeQuestions(existing, [draft('fresh one')], 'technical');
    expect(result.replaced).toBe(2);
    expect(result.items.map((q) => q.prompt)).toEqual(['fresh one']);
  });

  it('keeps a question the user edited', () => {
    const existing = [
      question('q1', ['r1'], { origin: 'edited', prompt: 'my edited question' }),
      question('q2', ['r1']),
    ];
    const result = mergeQuestions(existing, [draft('fresh one')], 'technical');
    expect(result.kept).toBe(1);
    expect(result.items.map((q) => q.prompt)).toContain('my edited question');
    expect(result.items.map((q) => q.id)).toContain('q1');
  });

  it('keeps a question the user wrote by hand', () => {
    const existing = [question('q1', ['r1'], { origin: 'manual', prompt: 'mine' })];
    const result = mergeQuestions(existing, [draft('fresh')], 'technical');
    expect(result.items.map((q) => q.prompt)).toEqual(['mine', 'fresh']);
  });

  it('keeps a pinned question even though it was generated', () => {
    const existing = [question('q1', ['r1'], { pinned: true, prompt: 'pinned' })];
    const result = mergeQuestions(existing, [draft('fresh')], 'technical');
    expect(result.items.map((q) => q.prompt)).toEqual(['pinned', 'fresh']);
  });

  it('never touches another category', () => {
    const existing = [
      question('q1', ['r1'], { category: 'behavioural', prompt: 'behavioural one' }),
      question('q2', ['r1'], { category: 'technical' }),
    ];
    const result = mergeQuestions(existing, [draft('fresh technical')], 'technical');
    expect(result.items.map((q) => q.prompt)).toEqual(['behavioural one', 'fresh technical']);
  });

  it('mints ids that collide with nothing in the kit', () => {
    const existing = [
      question('q1', ['r1'], { category: 'behavioural' }),
      question('q2', ['r1'], { origin: 'edited' }),
      question('q3', ['r1']),
    ];
    const result = mergeQuestions(existing, [draft('a'), draft('b')], 'technical');
    const ids = result.items.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('q1');
    expect(ids).toContain('q2');
    expect(ids).toContain('q4');
  });
});

describe('mergeFlashcards', () => {
  it('preserves edited and pinned cards and replaces the rest', () => {
    const existing = [
      card('f1'),
      { ...card('f2'), origin: 'edited' as const },
      { ...card('f3'), pinned: true },
    ];
    const result = mergeFlashcards(existing, [
      { front: 'new', back: 'card', requirement_ids: [], origin: 'generated', pinned: false },
    ]);
    expect(result.items.map((f) => f.id)).toEqual(['f2', 'f3', 'f4']);
    expect(result.kept).toBe(2);
    expect(result.replaced).toBe(1);
  });
});

describe('mergeCompanyBrief', () => {
  const fresh = { summary: 'new summary', what_they_do: 'new', sources: [] };

  it('replaces a generated brief', () => {
    const result = mergeCompanyBrief(
      { summary: 'old', what_they_do: 'old', sources: [], origin: 'generated', pinned: false },
      fresh,
    );
    expect(result.brief.summary).toBe('new summary');
  });

  it('refuses to overwrite a pinned brief', () => {
    const result = mergeCompanyBrief(
      { summary: 'mine', what_they_do: 'mine', sources: [], origin: 'edited', pinned: true },
      fresh,
    );
    expect(result.kept).toBe(true);
    expect(result.brief.summary).toBe('mine');
  });
});

describe('pruneScheduleReferences', () => {
  it('drops schedule references to deleted questions', () => {
    const target = kit({
      questions: [question('q1', ['r1'])],
      schedule: { days_available: 1, days: [{ day: 1, focus: 'f', question_ids: ['q1', 'q2'], minutes: 30 }] },
    });
    expect(pruneScheduleReferences(target).removed).toBe(1);
    expect(target.schedule.days[0].question_ids).toEqual(['q1']);
  });
});

describe('merge ordering', () => {
  it('places the new draft after the questions that survived, not before them', () => {
    const existing = [
      question('q1', ['r1'], { origin: 'edited', prompt: 'edited' }),
      question('q2', ['r1'], { pinned: true, prompt: 'pinned' }),
      question('q3', ['r1'], { prompt: 'replaceable' }),
    ];
    const result = mergeQuestions(existing, [draft('fresh')], 'technical');
    expect(result.items.map((q) => q.prompt)).toEqual(['edited', 'pinned', 'fresh']);
  });
});
