import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { PracticeSession } from '@/components/practice/PracticeSession';

export const dynamic = 'force-dynamic';

export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const record = await getRepositories().kits.findById(id, user.id);
  if (!record) notFound();

  if (record.status !== 'done') {
    return (
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <h1 className="text-xl font-semibold">This kit is not ready yet</h1>
        <p className="text-sm text-muted">Practice opens once generation has finished.</p>
        <Link href={`/kits/${id}`} className="inline-block rounded-lg border border-line px-3.5 py-2 text-sm">
          Back to the kit
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Practice · <span className="font-normal text-muted">{record.kit.role.title}</span>
        </h1>
        <p className="text-xs text-muted">Space reveals · 1, 2, 3 rate</p>
      </div>
      <PracticeSession kitId={id} kit={record.kit} initialPractice={record.practice ?? {}} />
    </div>
  );
}
