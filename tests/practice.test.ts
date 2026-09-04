import { describe, expect, it } from 'vitest';
import { orderForSession, practiceStats, recordAnswer, weakSpots, nextIntervalMs } from '../src/core/practice';
import { card } from './helpers';

const now = new Date('2026-09-01T09:00:00Z');
const cards = [card('f1', ['r1']), card('f2', ['r2']), card('f3', ['r1'])];

describe('recordAnswer', () => {
  it('brings a shaky card back within the session and resets the streak', () => {
    const first = recordAnswer(undefined, 'f1', 3, now);
    const second = recordAnswer(first, 'f1', 1, now);
    expect(second.reps).toBe(0);
    expect(Date.parse(second.dueAt) - now.getTime()).toBe(nextIntervalMs(1, 0));
  });

  it('lengthens the interval as a card is answered confidently', () => {
    let record = recordAnswer(undefined, 'f1', 3, now);
    const first = Date.parse(record.dueAt) - now.getTime();
    record = recordAnswer(record, 'f1', 3, now);
    expect(Date.parse(record.dueAt) - now.getTime()).toBeGreaterThan(first);
  });
});

describe('orderForSession', () => {
  it('puts unseen cards first', () => {
    const practice = { f1: recordAnswer(undefined, 'f1', 3, now) };
    const order = orderForSession(cards, practice, now);
    expect(order[0].state).toBe('new');
    expect(order.at(-1)!.card.id).toBe('f1');
  });

  it('orders seen cards by how confident the user felt, weakest first', () => {
    const practice = {
      f1: recordAnswer(undefined, 'f1', 3, now),
      f2: recordAnswer(undefined, 'f2', 1, now),
      f3: recordAnswer(undefined, 'f3', 2, now),
    };
    const later = new Date(now.getTime() + 5 * 24 * 60 * 60_000);
    expect(orderForSession(cards, practice, later).map((c) => c.card.id)).toEqual(['f2', 'f3', 'f1']);
  });
});

describe('practiceStats', () => {
  it('reports what has been covered and what is shaky', () => {
    const practice = {
      f1: recordAnswer(undefined, 'f1', 1, now),
      f2: recordAnswer(undefined, 'f2', 3, now),
    };
    const stats = practiceStats(cards, practice, now);
    expect(stats).toMatchObject({ total: 3, seen: 2, shaky: 1, confident: 1, coveragePercent: 67 });
  });
});

describe('weakSpots', () => {
  const requirements = [
    { id: 'r1', text: 'React', priority: 'must' as const },
    { id: 'r2', text: 'Terraform', priority: 'nice' as const },
  ];

  it('rolls card confidence up to the requirement, must-haves first', () => {
    const practice = {
      f1: recordAnswer(undefined, 'f1', 1, now),
      f3: recordAnswer(undefined, 'f3', 2, now),
      f2: recordAnswer(undefined, 'f2', 3, now),
    };
    const spots = weakSpots(cards, requirements, practice);
    expect(spots[0]).toMatchObject({ requirementId: 'r1', meanConfidence: 1.5, cardsSeen: 2, cardsTotal: 2 });
    expect(spots[1].requirementId).toBe('r2');
  });

  it('ignores requirements with no cards at all', () => {
    expect(weakSpots(cards, [{ id: 'r9', text: 'Go', priority: 'must' }], {})).toEqual([]);
  });
});
