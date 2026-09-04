import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { createKit } from '@/server/kitService';
import { ok, readJson, withErrorHandling } from '@/server/http';
import { progressPercent, STEP_LABELS } from '@/core/pipeline';

/** One case; the batch form is the same shape repeated. */
const CaseInput = z.object({
  jd: z.string().min(1, 'Paste the job description.').max(60_000),
  companyUrl: z.string().min(1, 'Add the company website.').max(2000),
  days: z.coerce.number().int().min(1).max(90),
  title: z.string().max(200).optional(),
});

const Body = z.union([
  CaseInput,
  z.object({ cases: z.array(CaseInput).min(1).max(20) }),
]);

export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  const records = await getRepositories().kits.listByUser(user.id);
  return ok({
    kits: records.map((record) => ({
      id: record.id,
      title: record.title,
      status: record.status,
      step: record.step,
      stepLabel: STEP_LABELS[record.step],
      progress: progressPercent(record),
      company: record.kit.source.company || record.input.companyUrl,
      companyUrl: record.input.companyUrl,
      role: record.kit.source.role,
      days: record.input.days,
      questionCount: record.kit.questions.length,
      requirementCount: record.kit.role.requirements.length,
      uncovered: record.kit.coverage.uncovered_requirement_ids.length,
      error: record.error,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })),
  });
});

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireUser();
  const body = await readJson(request, Body);
  const cases = 'cases' in body ? body.cases : [body];

  // Creation only records intent; generation happens through /advance, so a slow
  // pipeline can never hold this request open.
  const created = [];
  for (const input of cases) {
    const { record, duplicate } = await createKit(user.id, input);
    created.push({ id: record.id, title: record.title, status: record.status, duplicate });
  }

  return ok({ kits: created }, { status: 201 });
});
