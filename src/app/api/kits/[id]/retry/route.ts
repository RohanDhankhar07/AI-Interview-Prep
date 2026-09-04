import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { BadRequestError, NotFoundError, ok, withErrorHandling } from '@/server/http';

/**
 * Restarts a failed run from the step it stopped on. Everything already produced
 * — extracted requirements, retrieved pages, generated questions — is kept, so a
 * retry after a rate limit costs only the steps that did not finish.
 */
type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;

  const { kits } = getRepositories();
  const record = await kits.findById(id, user.id);
  if (!record) throw new NotFoundError('Kit not found.');
  if (record.status !== 'failed') throw new BadRequestError('This kit has not failed.');

  const updated = await kits.update(id, user.id, { status: 'running', error: null, leaseUntil: null });
  return ok({ status: updated!.status, step: updated!.step });
});
