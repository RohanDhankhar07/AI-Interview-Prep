import type { Question, Requirement, Schedule, ScheduleDay } from './types';
import { keywords } from './text';

/**
 * Schedule allocation is arithmetic, so it lives in code. The model never sees
 * this step. Guarantees, all checked by tests:
 *   - schedule.days.length === days_available, exactly
 *   - every question is scheduled at least once, so every covered requirement
 *     (including every must-have) appears somewhere
 *   - harder / must-have material lands on earlier days
 *   - minutes are integers
 */

/** Study minutes budgeted per question, by difficulty. */
const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 8, 2: 12, 3: 18 };
/** A revisit costs less than first contact. */
const REVIEW_FACTOR = 0.5;
const MIN_DAY_MINUTES = 15;
/** Day 1 gets 25% more than the mean, the last learning day 25% less. */
const FRONT_LOAD = 0.25;

export interface ScheduleInput {
  questions: Question[];
  requirements: Requirement[];
  days_available: number;
  /**
   * Optional practice feedback: question id -> mean confidence (1 low, 3 high).
   * When present, weaker material is pulled earlier within its priority band, so
   * a re-planned schedule reflects what the user actually struggled with.
   */
  confidenceByQuestionId?: Record<string, number>;
}

export function questionMinutes(q: Question): number {
  return MINUTES_BY_DIFFICULTY[q.difficulty] ?? 12;
}

/** Highest priority among the requirements a question covers. */
function priorityOf(q: Question, reqs: Map<string, Requirement>): 0 | 1 {
  return q.requirement_ids.some((id) => reqs.get(id)?.priority === 'must') ? 1 : 0;
}

/** Hardest and most important first. Ties break on id so the order is stable. */
export function rankQuestions(
  questions: Question[],
  requirements: Requirement[],
  confidenceByQuestionId: Record<string, number> = {},
): Question[] {
  const reqs = new Map(requirements.map((r) => [r.id, r]));
  // 0 when the user has not practised this material, so ordering is unchanged
  // until there is real feedback to act on.
  const weakness = (q: Question): number => {
    const confidence = confidenceByQuestionId[q.id];
    return confidence === undefined ? 0 : Math.round(3 - confidence);
  };
  const categoryWeight: Record<string, number> = {
    'system-design': 3,
    technical: 2,
    behavioural: 1,
    'company-fit': 0,
  };
  return [...questions].sort((a, b) => {
    const p = priorityOf(b, reqs) - priorityOf(a, reqs);
    if (p !== 0) return p;
    const w = weakness(b) - weakness(a);
    if (w !== 0) return w;
    if (b.difficulty !== a.difficulty) return b.difficulty - a.difficulty;
    const c = (categoryWeight[b.category] ?? 0) - (categoryWeight[a.category] ?? 0);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id, 'en', { numeric: true });
  });
}

/** A short, human focus line derived from the day's own material — no LLM call. */
function focusFor(dayQuestions: Question[], requirements: Requirement[], isReview: boolean): string {
  if (dayQuestions.length === 0) return 'Rest day — no material allocated';
  const reqs = new Map(requirements.map((r) => [r.id, r]));
  const counts = new Map<string, number>();
  for (const q of dayQuestions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const topCategory = [...counts].sort((a, b) => b[1] - a[1])[0][0];

  const seen = new Set<string>();
  const topics: string[] = [];
  for (const q of dayQuestions) {
    for (const rid of q.requirement_ids) {
      const req = reqs.get(rid);
      if (!req) continue;
      const topic = topicLabel(req.text);
      if (topic && !seen.has(topic.toLowerCase())) {
        seen.add(topic.toLowerCase());
        topics.push(topic);
      }
    }
    if (topics.length >= 3) break;
  }
  const label = topCategory.replace(/-/g, ' ');
  const head = isReview ? `Review — ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
  return topics.length ? `${head}: ${topics.slice(0, 3).join(', ')}` : head;
}

/** First few meaningful words of a requirement, as a topic label. */
function topicLabel(text: string): string {
  const words = [...keywords(text)];
  return words.slice(0, 2).join(' ');
}

export function allocateSchedule({
  questions,
  requirements,
  days_available,
  confidenceByQuestionId = {},
}: ScheduleInput): Schedule {
  const days = Math.max(1, Math.floor(days_available));

  if (questions.length === 0) {
    return {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        focus: 'No questions available — re-read the job description and add your own',
        question_ids: [],
        minutes: 0,
      })),
    };
  }

  const ranked = rankQuestions(questions, requirements, confidenceByQuestionId);
  const learningDays = Math.min(days, ranked.length);
  const totalMinutes = ranked.reduce((sum, q) => sum + questionMinutes(q), 0);
  const meanPerDay = totalMinutes / learningDays;

  // Capacity tapers from 1.25x the mean on day 1 down to 0.75x on the last
  // learning day, so the heavy, must-have material sits at the front.
  const capacity = (index: number): number => {
    if (learningDays === 1) return Number.POSITIVE_INFINITY;
    const t = index / (learningDays - 1);
    return meanPerDay * (1 + FRONT_LOAD - 2 * FRONT_LOAD * t);
  };

  const buckets: Question[][] = Array.from({ length: learningDays }, () => []);
  let day = 0;
  let used = 0;
  ranked.forEach((q, i) => {
    const remainingQuestions = ranked.length - i; // including this one
    const daysAfterCurrent = learningDays - 1 - day;
    const dayIsEmpty = buckets[day].length === 0;
    // Every day must end up with at least one question, so we advance either
    // because this day is full or because the questions left exactly cover the
    // days left. A day that is still empty always keeps the question.
    const mustAdvance = remainingQuestions <= daysAfterCurrent;
    const dayIsFull = used >= capacity(day);
    if (!dayIsEmpty && daysAfterCurrent > 0 && (mustAdvance || dayIsFull)) {
      day++;
      used = 0;
    }
    buckets[day].push(q);
    used += questionMinutes(q);
  });

  const scheduleDays: ScheduleDay[] = buckets.map((qs, i) => ({
    day: i + 1,
    focus: focusFor(qs, requirements, false),
    question_ids: qs.map((q) => q.id),
    minutes: Math.max(
      MIN_DAY_MINUTES,
      Math.round(qs.reduce((sum, q) => sum + questionMinutes(q), 0)),
    ),
  }));

  // More days than material: the surplus becomes spaced review, cycling back
  // through the hardest and highest-priority questions first.
  const reviewDays = days - learningDays;
  if (reviewDays > 0) {
    const pool = ranked.length ? ranked : [];
    const perReviewDay = Math.max(1, Math.min(5, Math.ceil(pool.length / Math.max(1, reviewDays))));
    let cursor = 0;
    for (let i = 0; i < reviewDays; i++) {
      const slice: Question[] = [];
      for (let k = 0; k < perReviewDay; k++) {
        slice.push(pool[cursor % pool.length]);
        cursor++;
      }
      scheduleDays.push({
        day: learningDays + i + 1,
        focus: focusFor(slice, requirements, true),
        question_ids: slice.map((q) => q.id),
        minutes: Math.max(
          MIN_DAY_MINUTES,
          Math.round(slice.reduce((s, q) => s + questionMinutes(q) * REVIEW_FACTOR, 0)),
        ),
      });
    }
  }

  return { days_available: days, days: scheduleDays };
}
