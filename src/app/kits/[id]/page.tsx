import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { progressPercent, STEP_LABELS } from '@/core/pipeline';
import { toState } from '@/server/kitService';
import { KitWorkspace } from '@/components/kit/KitWorkspace';

export const dynamic = 'force-dynamic';

export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const record = await getRepositories().kits.findById(id, user.id);
  if (!record) notFound();

  return (
    <KitWorkspace
      initial={{
        id: record.id,
        title: record.title,
        status: record.status,
        stepLabel: STEP_LABELS[record.step] ?? 'Working',
        progress: progressPercent(toState(record)),
        error: record.error,
        data: record.kit,
      }}
    />
  );
}
