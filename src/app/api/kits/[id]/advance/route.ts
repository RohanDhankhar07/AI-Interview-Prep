import { requireUser } from '@/server/auth';
import { advanceKit, toState } from '@/server/kitService';
import { ok, withErrorHandling } from '@/server/http';
import { progressPercent, STEP_LABELS } from '@/core/pipeline';

/**
 * Drives one slice of generation. The client calls this repeatedly while the kit
 * is running, which is what gives the UI real progress.
 *
 * Two different limits are at work, and they are not the same thing:
 *
 *  - ADVANCE_BUDGET_MS (25s) is a UX choice. It decides when this call stops
 *    *starting* new steps and hands back a progress update, so a two-minute
 *    generation reports in several times instead of going quiet.
 *  - maxDuration is a safety ceiling. A step already in flight when the budget
 *    runs out is allowed to finish, and one model call with rate-limit backoff
 *    can take well over a minute on a free tier. At the old 60s this killed the
 *    step mid-flight and threw away its work.
 */
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const record = await advanceKit(user.id, id, Number(process.env.ADVANCE_BUDGET_MS ?? 25_000));

  return ok({
    status: record.status,
    step: record.step,
    stepLabel: STEP_LABELS[record.step],
    progress: progressPercent(toState(record)),
    error: record.error,
    events: record.events.slice(-12),
    data: record.status === 'done' ? record.kit : null,
  });
});
