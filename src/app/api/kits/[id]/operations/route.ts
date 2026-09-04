import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { BadRequestError, ConflictError, NotFoundError, ok, readJson, withErrorHandling } from '@/server/http';
import { applyOperations, MutationError, OperationSchema } from '@/core/mutations';
import { validateKit } from '@/core/validate';

/**
 * Every builder edit lands here. Operations are applied to the stored kit, the
 * result is validated against the kit structure, and only then is it saved — a
 * client can never write a kit that would not survive validation.
 */

const Body = z.object({ operations: z.array(OperationSchema).min(1).max(50) });

type Context = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const { operations } = await readJson(request, Body);

  const { kits } = getRepositories();
  const record = await kits.findById(id, user.id);
  if (!record) throw new NotFoundError('Kit not found.');
  if (record.status === 'running') {
    throw new ConflictError('This kit is still being generated. Wait for it to finish before editing.');
  }

  let next;
  try {
    next = applyOperations(record.kit, operations);
  } catch (error) {
    if (error instanceof MutationError) throw new BadRequestError(error.message);
    throw error;
  }

  const validation = validateKit(next);
  if (!validation.ok) {
    throw new BadRequestError(`That edit would break the kit: ${validation.errors.join('; ')}`);
  }

  const scheduleEdited =
    record.scheduleEdited || operations.some((op) => op.type === 'schedule.day.update');
  const updated = await kits.update(id, user.id, { kit: validation.kit!, scheduleEdited });
  return ok({ data: updated!.kit });
});
