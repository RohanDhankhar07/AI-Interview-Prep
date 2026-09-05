import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { regenerateSection, type RegenerableSection } from '@/server/kitService';
import { ok, readJson, withErrorHandling } from '@/server/http';
import { QUESTION_CATEGORIES } from '@/core/types';

/**
 * Regenerating the brief re-crawls the company site before it calls the model,
 * and a question category can need a gap-closing pass on top. Both sit well
 * inside this, but a rate-limited free tier is unpredictable enough to want the
 * headroom rather than lose the work.
 */
export const maxDuration = 300;

const Body = z.object({
  section: z.union([
    z.literal('company_brief'),
    z.literal('flashcards'),
    z.literal('schedule'),
    ...QUESTION_CATEGORIES.map((c) => z.literal(`questions:${c}` as const)),
  ]),
});

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const { section } = await readJson(request, Body);

  const { record, summary } = await regenerateSection(user.id, id, section as RegenerableSection);
  return ok({ data: record.kit, summary });
});
