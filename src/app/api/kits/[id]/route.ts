import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { NotFoundError, ok, withErrorHandling } from '@/server/http';
import { progressPercent, STEP_LABELS } from '@/core/pipeline';
import { toState } from '@/server/kitService';

type Context = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const record = await getRepositories().kits.findById(id, user.id);
  if (!record) throw new NotFoundError('Kit not found.');

  return ok({
    kit: {
      id: record.id,
      title: record.title,
      status: record.status,
      step: record.step,
      stepLabel: STEP_LABELS[record.step],
      progress: progressPercent(toState(record)),
      error: record.error,
      input: record.input,
      data: record.kit,
      practice: record.practice ?? {},
      events: record.events.slice(-40),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  });
});

export const DELETE = withErrorHandling(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const removed = await getRepositories().kits.remove(id, user.id);
  if (!removed) throw new NotFoundError('Kit not found.');
  return ok({ ok: true });
});
