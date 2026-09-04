import { describe, expect, it } from 'vitest';
import { allocateSchedule, rankQuestions, questionMinutes } from '../src/core/schedule';
import { question, req } from './helpers';

const requirements = [
  req('r1', 'Kubernetes operations', 'must'),
  req('r2', 'Mentoring junior engineers', 'nice', 'behavioural'),
];

function manyQuestions(n: number) {
  return Array.from({ length: n }, (_, i) =>
    question(`q${i + 1}`, [i % 2 === 0 ? 'r1' : 'r2'], {
      difficulty: ((i % 3) + 1) as 1 | 2 | 3,
    }),
  );
}

describe('allocateSchedule', () => {
  it('produces exactly the number of days requested', () => {
    for (const days of [1, 2, 3, 5, 14, 60]) {
      const schedule = allocateSchedule({ questions: manyQuestions(12), requirements, days_available: days });
      expect(schedule.days).toHaveLength(days);
      expect(schedule.days_available).toBe(days);
      expect(schedule.days.map((d) => d.day)).toEqual(
        Array.from({ length: days }, (_, i) => i + 1),
      );
    }
  });

  it('schedules every question at least once', () => {
    const questions = manyQuestions(17);
    const schedule = allocateSchedule({ questions, requirements, days_available: 4 });
    const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
    for (const q of questions) expect(scheduled.has(q.id)).toBe(true);
  });

  it('puts every must-have requirement somewhere in the schedule', () => {
    const questions = manyQuestions(9);
    const schedule = allocateSchedule({ questions, requirements, days_available: 3 });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const covered = new Set(
      schedule.days.flatMap((d) => d.question_ids).flatMap((id) => byId.get(id)!.requirement_ids),
    );
    for (const r of requirements.filter((r) => r.priority === 'must')) {
      expect(covered.has(r.id)).toBe(true);
    }
  });

  it('front-loads harder and must-have material', () => {
    const questions = [
      question('q1', ['r2'], { difficulty: 1 }),
      question('q2', ['r2'], { difficulty: 1 }),
      question('q3', ['r1'], { difficulty: 3 }),
      question('q4', ['r1'], { difficulty: 3 }),
    ];
    const schedule = allocateSchedule({ questions, requirements, days_available: 2 });
    expect(schedule.days[0].question_ids).toEqual(['q3', 'q4']);
    expect(schedule.days[1].question_ids).toEqual(['q1', 'q2']);
  });

  it('uses integer minutes on every day', () => {
    const schedule = allocateSchedule({ questions: manyQuestions(7), requirements, days_available: 5 });
    for (const day of schedule.days) expect(Number.isInteger(day.minutes)).toBe(true);
  });

  it('fills surplus days with review rather than leaving them empty', () => {
    const schedule = allocateSchedule({ questions: manyQuestions(3), requirements, days_available: 10 });
    expect(schedule.days).toHaveLength(10);
    for (const day of schedule.days) expect(day.question_ids.length).toBeGreaterThan(0);
    expect(schedule.days.at(-1)!.focus.toLowerCase()).toContain('review');
  });

  it('collapses everything into one day when only one day is available', () => {
    const questions = manyQuestions(11);
    const schedule = allocateSchedule({ questions, requirements, days_available: 1 });
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].question_ids).toHaveLength(11);
    expect(schedule.days[0].minutes).toBe(
      questions.reduce((sum, q) => sum + questionMinutes(q), 0),
    );
  });

  it('still returns the requested days when there are no questions', () => {
    const schedule = allocateSchedule({ questions: [], requirements, days_available: 4 });
    expect(schedule.days).toHaveLength(4);
    expect(schedule.days.every((d) => d.question_ids.length === 0)).toBe(true);
    expect(schedule.days.every((d) => d.minutes === 0)).toBe(true);
  });

  it('ranks must-have and harder questions first, stably', () => {
    const ranked = rankQuestions(
      [
        question('q1', ['r2'], { difficulty: 3 }),
        question('q2', ['r1'], { difficulty: 1 }),
        question('q3', ['r1'], { difficulty: 3 }),
      ],
      requirements,
    );
    expect(ranked.map((q) => q.id)).toEqual(['q3', 'q2', 'q1']);
  });
});
