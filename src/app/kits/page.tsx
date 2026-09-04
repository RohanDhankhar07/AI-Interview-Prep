import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { progressPercent, STEP_LABELS } from '@/core/pipeline';
import { NewKitForm } from '@/components/NewKitForm';
import { KitList, type KitSummary } from '@/components/KitList';

export const dynamic = 'force-dynamic';

export default async function KitsPage() {
  const user = await requireUser();
  const records = await getRepositories().kits.listByUser(user.id);

  const kits: KitSummary[] = records.map((record) => ({
    id: record.id,
    title: record.title,
    status: record.status,
    stepLabel: STEP_LABELS[record.step] ?? record.step,
    progress: progressPercent(record),
    company: record.kit.source.company || record.input.companyUrl,
    role: record.kit.source.role,
    days: record.input.days,
    questionCount: record.kit.questions.length,
    requirementCount: record.kit.role.requirements.length,
    uncovered: record.kit.coverage.uncovered_requirement_ids.length,
    errorMessage: record.error?.message ?? null,
    updatedAt: record.updatedAt,
  }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="new-kit">
        <h1 id="new-kit" className="text-xl font-semibold tracking-tight">
          Build a prep kit
        </h1>
        <p className="mt-1 mb-4 text-sm text-muted">
          Paste the posting and point us at the company. Generation takes a minute or two and you can
          watch it happen.
        </p>
        <NewKitForm />
      </section>

      <section aria-labelledby="your-kits" className="space-y-4">
        <h2 id="your-kits" className="text-xl font-semibold tracking-tight">
          Your kits
        </h2>
        <KitList initialKits={kits} />
      </section>
    </div>
  );
}
