import type { Flashcard } from './types';

/**
 * Practice scheduling: a deliberately small spaced-repetition scheme.
 *
 * Full SM-2 tunes an ease factor per card from a five-point grade. With three
 * buttons and a study window measured in days, that extra machinery cannot pay
 * for itself, so the interval is a function of confidence and streak length,
 * and the session order puts unseen and least-confident material first.
 */

export type Confidence = 1 | 2 | 3;

export interface PracticeRecord {
  cardId: string;
  confidence: Confidence;
  reps: number;
  lastSeenAt: string;
  dueAt: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Days until a card comes back, given how it just went and how well it has gone before. */
export function nextIntervalMs(confidence: Confidence, reps: number): number {
  if (confidence === 1) return 10 * MINUTE; // shaky: come back this session
  if (confidence === 2) return Math.min(3, Math.max(1, reps)) * DAY;
  return Math.min(21, 2 ** Math.max(0, reps)) * DAY;
}

export function recordAnswer(
  previous: PracticeRecord | undefined,
  cardId: string,
  confidence: Confidence,
  now = new Date(),
): PracticeRecord {
  // A shaky answer resets the streak; anything else extends it.
  const reps = confidence === 1 ? 0 : (previous?.reps ?? 0) + 1;
  return {
    cardId,
    confidence,
    reps,
    lastSeenAt: now.toISOString(),
    dueAt: new Date(now.getTime() + nextIntervalMs(confidence, reps)).toISOString(),
  };
}

export interface SessionCard {
  card: Flashcard;
  record?: PracticeRecord;
  state: 'new' | 'due' | 'later';
}

/**
 * The next session: never-seen cards and cards you found hard come first,
 * cards you have already answered confidently and that are not yet due come last.
 */
export function orderForSession(
  cards: Flashcard[],
  practice: Record<string, PracticeRecord>,
  now = new Date(),
): SessionCard[] {
  const timestamp = now.getTime();
  return cards
    .map((card): SessionCard => {
      const record = practice[card.id];
      if (!record) return { card, state: 'new' };
      return { card, record, state: Date.parse(record.dueAt) <= timestamp ? 'due' : 'later' };
    })
    .sort((a, b) => {
      const rank = { new: 0, due: 0, later: 1 } as const;
      if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
      const confidenceA = a.record?.confidence ?? 0;
      const confidenceB = b.record?.confidence ?? 0;
      if (confidenceA !== confidenceB) return confidenceA - confidenceB;
      const dueA = a.record ? Date.parse(a.record.dueAt) : 0;
      const dueB = b.record ? Date.parse(b.record.dueAt) : 0;
      return dueA - dueB;
    });
}

export interface PracticeStats {
  total: number;
  seen: number;
  due: number;
  shaky: number;
  confident: number;
  coveragePercent: number;
}

export function practiceStats(
  cards: Flashcard[],
  practice: Record<string, PracticeRecord>,
  now = new Date(),
): PracticeStats {
  const seen = cards.filter((c) => practice[c.id]);
  return {
    total: cards.length,
    seen: seen.length,
    due: seen.filter((c) => Date.parse(practice[c.id].dueAt) <= now.getTime()).length,
    shaky: seen.filter((c) => practice[c.id].confidence === 1).length,
    confident: seen.filter((c) => practice[c.id].confidence === 3).length,
    coveragePercent: cards.length ? Math.round((seen.length / cards.length) * 100) : 0,
  };
}

export interface WeakSpot {
  requirementId: string;
  text: string;
  priority: 'must' | 'nice';
  meanConfidence: number;
  cardsSeen: number;
  cardsTotal: number;
}

/**
 * The weak-spots report: practice happens on cards, but the kit is organised
 * around requirements, so confidence is rolled up to the requirement that the
 * interviewer will actually probe.
 */
export function weakSpots(
  cards: Flashcard[],
  requirements: { id: string; text: string; priority: 'must' | 'nice' }[],
  practice: Record<string, PracticeRecord>,
): WeakSpot[] {
  return requirements
    .map((requirement) => {
      const related = cards.filter((c) => c.requirement_ids.includes(requirement.id));
      const scores = related.map((c) => practice[c.id]?.confidence).filter((n): n is Confidence => Boolean(n));
      return {
        requirementId: requirement.id,
        text: requirement.text,
        priority: requirement.priority,
        meanConfidence: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        cardsSeen: scores.length,
        cardsTotal: related.length,
      };
    })
    .filter((spot) => spot.cardsTotal > 0)
    .sort((a, b) => {
      // Unpractised must-haves are the biggest risk, then the lowest confidence.
      if (a.priority !== b.priority) return a.priority === 'must' ? -1 : 1;
      return a.meanConfidence - b.meanConfidence;
    });
}
