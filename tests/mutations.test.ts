import { describe, expect, it } from 'vitest';
import { applyOperation, applyOperations, MutationError } from '../src/core/mutations';
import { validateKit } from '../src/core/validate';
import { card, kit, question, req } from './helpers';

const base = kit({
  role: {
    title: 'Engineer',
    seniority: 'senior',
    responsibilities: [],
    requirements: [req('r1', 'React'), req('r2', 'Kubernetes')],
  },
  questions: [
    question('q1', ['r1'], { prompt: 'React question' }),
    question('q2', ['r2'], { prompt: 'Kubernetes question' }),
    question('q3', ['r1'], { category: 'behavioural', prompt: 'Behavioural question' }),
  ],
  flashcards: [card('f1', ['r1'])],
  schedule: {
    days_available: 2,
    days: [
      { day: 1, focus: 'a', question_ids: ['q1', 'q2'], minutes: 30 },
      { day: 2, focus: 'b', question_ids: ['q3'], minutes: 30 },
    ],
  },
});

describe('builder edits', () => {
  it('marks an edited question so a regeneration will preserve it', () => {
    const next = applyOperation(base, {
      type: 'question.update',
      id: 'q1',
      patch: { prompt: 'My rewritten question about React' },
    });
    const edited = next.questions.find((q) => q.id === 'q1')!;
    expect(edited.prompt).toBe('My rewritten question about React');
    expect(edited.origin).toBe('edited');
    expect(base.questions[0].prompt).toBe('React question'); // input untouched
  });

  it('adds a hand-written question as manual and pinned', () => {
    const next = applyOperation(base, {
      type: 'question.add',
      question: {
        prompt: 'A question I wrote',
        answer_outline: '',
        category: 'technical',
        difficulty: 2,
        requirement_ids: ['r1'],
      },
    });
    const added = next.questions.at(-1)!;
    expect(added.id).toBe('q4');
    expect(added.origin).toBe('manual');
    expect(added.pinned).toBe(true);
  });

  it('reorders questions without losing any', () => {
    const next = applyOperation(base, { type: 'question.reorder', ids: ['q3', 'q1', 'q2'] });
    expect(next.questions.map((q) => q.id)).toEqual(['q3', 'q1', 'q2']);
  });

  it('keeps unmentioned questions when a partial order is sent', () => {
    const next = applyOperation(base, { type: 'question.reorder', ids: ['q3'] });
    expect(next.questions.map((q) => q.id)).toEqual(['q3', 'q1', 'q2']);
  });

  it('rejects a reorder that invents an id', () => {
    expect(() => applyOperation(base, { type: 'question.reorder', ids: ['q9'] })).toThrow(MutationError);
  });

  it('moves a question to another category and records it as an edit', () => {
    const next = applyOperation(base, { type: 'question.move', id: 'q1', category: 'system-design' });
    const moved = next.questions.find((q) => q.id === 'q1')!;
    expect(moved.category).toBe('system-design');
    expect(moved.origin).toBe('edited');
  });

  it('drops schedule references when a question is deleted', () => {
    const next = applyOperation(base, { type: 'question.delete', id: 'q2' });
    expect(next.questions.map((q) => q.id)).toEqual(['q1', 'q3']);
    expect(next.schedule.days[0].question_ids).toEqual(['q1']);
    expect(validateKit(next).ok).toBe(true);
  });

  it('recomputes coverage after an edit leaves a requirement bare', () => {
    const next = applyOperation(base, { type: 'question.delete', id: 'q2' });
    expect(next.coverage.uncovered_requirement_ids).toEqual(['r2']);
  });

  it('clears references when a requirement is deleted', () => {
    const next = applyOperation(base, { type: 'requirement.delete', id: 'r1' });
    expect(next.questions.every((q) => !q.requirement_ids.includes('r1'))).toBe(true);
    expect(next.flashcards.every((f) => !f.requirement_ids.includes('r1'))).toBe(true);
    expect(validateKit(next).ok).toBe(true);
  });

  it('refuses to link a question to a requirement that does not exist', () => {
    expect(() =>
      applyOperation(base, { type: 'question.update', id: 'q1', patch: { requirement_ids: ['r99'] } }),
    ).toThrow(MutationError);
  });

  it('refuses to schedule a question that does not exist', () => {
    expect(() =>
      applyOperation(base, { type: 'schedule.day.update', day: 1, patch: { question_ids: ['q404'] } }),
    ).toThrow(MutationError);
  });

  it('applies a sequence of operations in order', () => {
    const next = applyOperations(base, [
      { type: 'brief.update', patch: { summary: 'my summary' } },
      { type: 'brief.pin', pinned: true },
      { type: 'flashcard.add', flashcard: { front: 'q', back: 'a', requirement_ids: ['r2'] } },
    ]);
    expect(next.company_brief.summary).toBe('my summary');
    expect(next.company_brief.origin).toBe('edited');
    expect(next.company_brief.pinned).toBe(true);
    expect(next.flashcards.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(validateKit(next).ok).toBe(true);
  });

  it('keeps every kit it produces structurally valid', () => {
    const next = applyOperations(base, [
      { type: 'requirement.add', requirement: { text: 'Go', kind: 'technical', priority: 'must' } },
      { type: 'question.add', question: { prompt: 'Go question', answer_outline: '', category: 'technical', difficulty: 3, requirement_ids: ['r3'] } },
      { type: 'schedule.day.update', day: 2, patch: { minutes: 45, question_ids: ['q3', 'q4'] } },
    ]);
    expect(validateKit(next).errors).toEqual([]);
    expect(next.schedule.days[1].minutes).toBe(45);
  });
});
