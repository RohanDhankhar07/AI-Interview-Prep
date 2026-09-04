'use client';

import type { Kit } from '@/core/types';
import type { Operation } from '@/core/mutations';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { InlineEdit } from './InlineEdit';

/**
 * The schedule is computed in code, not written by the model, so "Re-allocate"
 * is a deterministic recalculation — and after a practice session it also takes
 * into account what the user found hard.
 */
export function ScheduleSection({
  kit,
  mutate,
  regenerate,
  regenerating,
}: {
  kit: Kit;
  mutate: (ops: Operation[], optimistic?: (kit: Kit) => Kit) => Promise<boolean>;
  regenerate: (section: string) => Promise<void>;
  regenerating: string | null;
}) {
  const questionsById = new Map(kit.questions.map((q) => [q.id, q]));
  const totalMinutes = kit.schedule.days.reduce((sum, day) => sum + day.minutes, 0);
  // Derived client-side: a hand-arranged schedule is never re-allocated for the
  // user, so it can fall behind the question bank. Say so rather than let it rot.
  const scheduled = new Set(kit.schedule.days.flatMap((day) => day.question_ids));
  const unscheduled = kit.questions.filter((q) => !scheduled.has(q.id));

  return (
    <section id="schedule" aria-labelledby="schedule-heading" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="schedule-heading" className="text-lg font-semibold tracking-tight">
            Study schedule
          </h2>
          <p className="mt-1 text-sm text-muted">
            {kit.schedule.days_available} day{kit.schedule.days_available === 1 ? '' : 's'} ·{' '}
            {Math.round(totalMinutes / 60)}h {totalMinutes % 60}m total · hardest and must-have material first
          </p>
        </div>
        <Button size="sm" disabled={Boolean(regenerating)} onClick={() => regenerate('schedule')}>
          {regenerating === 'schedule' ? 'Re-allocating…' : 'Re-allocate'}
        </Button>
      </div>

      {unscheduled.length > 0 ? (
        <Card className="border-warn/40 p-4 text-sm">
          <p className="font-medium text-warn">
            {unscheduled.length} question{unscheduled.length === 1 ? ' is' : 's are'} not in the schedule
          </p>
          <p className="mt-1 text-muted">
            Your hand-arranged days were kept as they are. Re-allocate to fold the new questions in —
            that replaces the arrangement with a fresh one.
          </p>
        </Card>
      ) : null}

      <ol className="space-y-3">
        {kit.schedule.days.map((day) => (
          <Card as="li" key={day.day} className="p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-medium">Day {day.day}</h3>
              <div className="min-w-[12rem] flex-1">
                <InlineEdit
                  label={`Focus for day ${day.day}`}
                  value={day.focus}
                  onSave={(focus) =>
                    mutate([{ type: 'schedule.day.update', day: day.day, patch: { focus } }], (current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        days: current.schedule.days.map((d) => (d.day === day.day ? { ...d, focus } : d)),
                      },
                    }))
                  }
                />
              </div>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-right text-xs"
                  value={day.minutes}
                  aria-label={`Minutes on day ${day.day}`}
                  onChange={(e) => {
                    const minutes = Math.max(0, Math.round(Number(e.target.value) || 0));
                    void mutate([{ type: 'schedule.day.update', day: day.day, patch: { minutes } }], (current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        days: current.schedule.days.map((d) => (d.day === day.day ? { ...d, minutes } : d)),
                      },
                    }));
                  }}
                />
                min
              </label>
            </div>

            {day.question_ids.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing allocated to this day.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {day.question_ids.map((id) => {
                  const question = questionsById.get(id);
                  return (
                    <li key={id} className="flex items-start gap-2 text-sm">
                      <Badge>{id}</Badge>
                      <span className="min-w-0 flex-1">{question?.prompt ?? 'Missing question'}</span>
                      {question ? (
                        <Badge tone={question.difficulty === 3 ? 'warn' : 'neutral'}>
                          D{question.difficulty}
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </ol>
    </section>
  );
}
