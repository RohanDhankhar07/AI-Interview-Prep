import { requireUser } from '@/server/auth';
import { advanceKit, toState } from '@/server/kitService';
import { ok, withErrorHandling } from '@/server/http';
import { progressPercent, STEP_LABELS } from '@/core/pipeline';

/**
 * Drives one slice of generation. The client calls this repeatedly while the kit
 * is running, which gives real progress and keeps every invocation well inside
 * the platform's function timeout.
 */
export const maxDuration = 60;

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
