import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { regenerateSection, type RegenerableSection } from '@/server/kitService';
import { ok, readJson, withErrorHandling } from '@/server/http';
import { QUESTION_CATEGORIES } from '@/core/types';

export const maxDuration = 60;

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
