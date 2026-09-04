'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { del, post, ApiError } from '@/lib/api';
import { Badge, Button, Card, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';

export interface KitSummary {
  id: string;
  title: string;
  status: 'running' | 'done' | 'failed';
  stepLabel: string;
  progress: number;
  company: string;
  role: string;
  days: number;
  questionCount: number;
  requirementCount: number;
  uncovered: number;
  errorMessage: string | null;
  updatedAt: string;
}

/**
 * The list also drives generation for kits created in a batch: each running kit
 * is advanced one slice at a time, in series, so twenty roles do not open twenty
 * concurrent pipelines against a free-tier model.
 */
export function KitList({ initialKits }: { initialKits: KitSummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [kits, setKits] = useState(initialKits);

  useEffect(() => setKits(initialKits), [initialKits]);

  useEffect(() => {
    const running = kits.filter((k) => k.status === 'running');
    if (running.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const kit of running) {
        if (cancelled) return;
        try {
          const result = await post<{ status: KitSummary['status']; progress: number; stepLabel: string }>(
            `/api/kits/${kit.id}/advance`,
          );
          if (cancelled) return;
          setKits((current) =>
            current.map((k) =>
              k.id === kit.id
                ? { ...k, status: result.status, progress: result.progress, stepLabel: result.stepLabel }
                : k,
            ),
          );
          if (result.status !== 'running') router.refresh();
          else await new Promise((r) => setTimeout(r, 1000));
        } catch (error) {
          // A conflict just means another tab is advancing this one.
          if (error instanceof ApiError && error.code !== 'CONFLICT') {
            setKits((current) =>
              current.map((k) => (k.id === kit.id ? { ...k, status: 'failed', errorMessage: error.message } : k)),
            );
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kits, router]);

  async function remove(kit: KitSummary) {
    if (!confirm(`Delete “${kit.title}”? This cannot be undone.`)) return;
    const previous = kits;
    setKits((current) => current.filter((k) => k.id !== kit.id));
    try {
      await del(`/api/kits/${kit.id}`);
      toast.push('Kit deleted.', 'success');
      router.refresh();
    } catch (error) {
      setKits(previous);
      toast.push(error instanceof ApiError ? error.message : 'Could not delete that kit.', 'error');
    }
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        title="No kits yet"
        body="Paste a job description above and we will research the company and build your first kit."
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {kits.map((kit) => (
        <Card as="li" key={kit.id} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/kits/${kit.id}`} className="block truncate font-medium hover:underline">
                {kit.role || kit.title}
              </Link>
              <p className="truncate text-sm text-muted">{kit.company}</p>
            </div>
            <StatusBadge kit={kit} />
          </div>

          {kit.status === 'running' ? (
            <div className="space-y-1.5">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-canvas"
                role="progressbar"
                aria-valuenow={kit.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Generating: ${kit.stepLabel}`}
              >
                <div
                  className="h-full rounded-full bg-brand transition-all duration-500"
                  style={{ width: `${kit.progress}%` }}
                />
              </div>
              <p className="text-xs text-muted">{kit.stepLabel}…</p>
            </div>
          ) : kit.status === 'failed' ? (
            <p className="text-xs text-bad">{kit.errorMessage ?? 'Generation failed.'}</p>
          ) : (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <div>
                <dt className="inline">Requirements: </dt>
                <dd className="inline font-medium text-ink">{kit.requirementCount}</dd>
              </div>
              <div>
                <dt className="inline">Questions: </dt>
                <dd className="inline font-medium text-ink">{kit.questionCount}</dd>
              </div>
              <div>
                <dt className="inline">Days: </dt>
                <dd className="inline font-medium text-ink">{kit.days}</dd>
              </div>
            </dl>
          )}

          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <Button size="sm" onClick={() => remove(kit)} variant="ghost" aria-label={`Delete ${kit.role || kit.title}`}>
              Delete
            </Button>
            <Link
              href={`/kits/${kit.id}`}
              className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium"
            >
              {kit.status === 'running' ? 'Watch' : 'Open'}
            </Link>
          </div>
        </Card>
      ))}
    </ul>
  );
}

function StatusBadge({ kit }: { kit: KitSummary }) {
  if (kit.status === 'running') return <Badge tone="brand">Generating</Badge>;
  if (kit.status === 'failed') return <Badge tone="bad">Failed</Badge>;
  if (kit.uncovered > 0) {
    return (
      <Badge tone="warn" title={`${kit.uncovered} requirement(s) without a question`}>
        {kit.uncovered} uncovered
      </Badge>
    );
  }
  return <Badge tone="good">Ready</Badge>;
}
