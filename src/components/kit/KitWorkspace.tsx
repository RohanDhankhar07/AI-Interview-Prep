'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { post, ApiError } from '@/lib/api';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import type { Kit } from '@/core/types';
import { useKitEditor } from './useKitEditor';
import { GenerationPanel } from './GenerationPanel';
import { BriefSection } from './BriefSection';
import { RequirementsSection } from './RequirementsSection';
import { QuestionsSection } from './QuestionsSection';
import { FlashcardsSection } from './FlashcardsSection';
import { ScheduleSection } from './ScheduleSection';
import { ResearchSection } from './ResearchSection';

export interface KitView {
  id: string;
  title: string;
  status: 'running' | 'done' | 'failed';
  stepLabel: string;
  progress: number;
  error: { code: string; message: string } | null;
  data: Kit;
}

const NAV = [
  ['brief', 'Company brief'],
  ['role', 'Role'],
  ['questions', 'Questions'],
  ['flashcards', 'Flashcards'],
  ['schedule', 'Schedule'],
  ['research', 'Research'],
] as const;

export function KitWorkspace({ initial }: { initial: KitView }) {
  const toast = useToast();
  const [status, setStatus] = useState(initial.status);
  const [error, setError] = useState(initial.error);
  const { kit, setKit, mutate, saving } = useKitEditor(initial.id, initial.data);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const onDone = useCallback(
    (data: Kit) => {
      setKit(data);
      setStatus('done');
    },
    [setKit],
  );

  const onFailed = useCallback((failure: { code: string; message: string }) => {
    setError(failure);
    setStatus('failed');
  }, []);

  async function regenerate(section: string) {
    setRegenerating(section);
    try {
      const result = await post<{ data: Kit; summary: string }>(`/api/kits/${initial.id}/regenerate`, {
        section,
      });
      setKit(result.data);
      toast.push(result.summary, 'success');
    } catch (caught) {
      toast.push(caught instanceof ApiError ? caught.message : 'Regeneration failed.', 'error');
    } finally {
      setRegenerating(null);
    }
  }

  if (status === 'running') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Header kit={kit} kitId={initial.id} status={status} saving={false} />
        <GenerationPanel
          kitId={initial.id}
          initialProgress={initial.progress}
          initialStepLabel={initial.stepLabel}
          onDone={onDone}
          onFailed={onFailed}
        />
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Header kit={kit} kitId={initial.id} status={status} saving={false} />
        <Card className="space-y-3 border-bad/40 p-6">
          <h2 className="font-medium text-bad">Generation did not finish</h2>
          <p className="text-sm">{error?.message ?? 'Something went wrong while building this kit.'}</p>
          {error?.code ? <Badge tone="bad">{error.code}</Badge> : null}
          <p className="text-sm text-muted">
            Everything already produced has been kept. Retrying continues from the step that failed
            rather than starting over.
          </p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await post(`/api/kits/${initial.id}/retry`);
                  setError(null);
                  setStatus('running');
                } catch (caught) {
                  toast.push(caught instanceof ApiError ? caught.message : 'Could not retry.', 'error');
                }
              }}
            >
              Retry from where it stopped
            </Button>
            <Link href="/kits" className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium">
              Back to kits
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header kit={kit} kitId={initial.id} status={status} saving={saving} />

      <div className="lg:grid lg:grid-cols-[10rem_1fr] lg:gap-8">
        <nav aria-label="Kit sections" className="mb-4 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-surface hover:text-ink"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-10">
          <CoverageBanner kit={kit} />
          <BriefSection kit={kit} mutate={mutate} regenerate={regenerate} regenerating={regenerating} />
          <RequirementsSection kit={kit} mutate={mutate} />
          <QuestionsSection kit={kit} mutate={mutate} regenerate={regenerate} regenerating={regenerating} />
          <FlashcardsSection
            kit={kit}
            kitId={initial.id}
            mutate={mutate}
            regenerate={regenerate}
            regenerating={regenerating}
          />
          <ScheduleSection kit={kit} mutate={mutate} regenerate={regenerate} regenerating={regenerating} />
          <ResearchSection kit={kit} />
        </div>
      </div>
    </div>
  );
}

function Header({
  kit,
  kitId,
  status,
  saving,
}: {
  kit: Kit;
  kitId: string;
  status: string;
  saving: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link href="/kits" className="text-sm text-muted hover:underline">
            Kits
          </Link>
          <span className="text-muted">/</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {kit.role.title || 'Untitled role'}
        </h1>
        <p className="text-sm text-muted">
          {kit.source.company || kit.source.company_url}
          {kit.source.location ? ` · ${kit.source.location}` : ''} · {kit.schedule.days_available} day
          {kit.schedule.days_available === 1 ? '' : 's'} to prepare
        </p>
      </div>

      {status === 'done' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="text-xs text-muted">
            {saving ? 'Saving…' : 'All changes saved'}
          </span>
          <Link
            href={`/kits/${kitId}/practice`}
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white dark:text-slate-900"
          >
            Practice
          </Link>
          <a
            href={`/api/kits/${kitId}/export`}
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium"
          >
            Export JSON
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** Coverage is the kit's one hard promise, so it is stated at the top, honestly. */
function CoverageBanner({ kit }: { kit: Kit }) {
  const requirements = new Map(kit.role.requirements.map((r) => [r.id, r]));
  const uncovered = kit.coverage.uncovered_requirement_ids.map((id) => requirements.get(id)).filter(Boolean);
  const uncoveredMust = uncovered.filter((r) => r!.priority === 'must');

  if (kit.role.requirements.length === 0) {
    return (
      <Card className="border-warn/40 p-4 text-sm">
        <p className="font-medium text-warn">This posting was too thin to extract requirements from.</p>
        <p className="mt-1 text-muted">
          Rather than inventing requirements, the kit stays small. Add what you can see in the posting
          under Role, then regenerate a question category.
        </p>
      </Card>
    );
  }

  if (uncovered.length === 0) {
    return (
      <Card className="border-good/40 p-4 text-sm">
        <p className="font-medium text-good">
          All {kit.role.requirements.length} requirements have at least one question.
        </p>
        <p className="mt-1 text-muted">
          Checked in code after {kit.coverage.passes} pass{kit.coverage.passes === 1 ? '' : 'es'}: a
          question only counts for a requirement if its text actually addresses it.
        </p>
      </Card>
    );
  }

  return (
    <Card className={`p-4 text-sm ${uncoveredMust.length ? 'border-bad/40' : 'border-warn/40'}`}>
      <p className={`font-medium ${uncoveredMust.length ? 'text-bad' : 'text-warn'}`}>
        {uncovered.length} requirement{uncovered.length === 1 ? '' : 's'} still without a question
        {uncoveredMust.length ? ` (${uncoveredMust.length} must-have)` : ''}
      </p>
      <ul className="mt-2 space-y-1 text-muted">
        {uncovered.map((requirement) => (
          <li key={requirement!.id}>
            <Badge tone={requirement!.priority === 'must' ? 'bad' : 'warn'}>{requirement!.id}</Badge>{' '}
            {requirement!.text}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted">
        Regenerate the matching question category, or write a question yourself and link it.
      </p>
    </Card>
  );
}
