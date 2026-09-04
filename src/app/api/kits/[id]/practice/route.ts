import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { BadRequestError, NotFoundError, ok, readJson, withErrorHandling } from '@/server/http';
import { recordAnswer } from '@/core/practice';

const Body = z.object({
  cardId: z.string().min(1),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const { cardId, confidence } = await readJson(request, Body);

  const { kits } = getRepositories();
  const record = await kits.findById(id, user.id);
  if (!record) throw new NotFoundError('Kit not found.');
  if (!record.kit.flashcards.some((c) => c.id === cardId)) {
    throw new BadRequestError(`No flashcard ${cardId} in this kit.`);
  }

  const practice = { ...(record.practice ?? {}) };
  practice[cardId] = recordAnswer(practice[cardId], cardId, confidence);

  const updated = await kits.update(id, user.id, { practice });
  return ok({ practice: updated!.practice });
});
