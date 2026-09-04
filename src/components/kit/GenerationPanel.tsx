'use client';

import { useEffect, useRef, useState } from 'react';
import { post, ApiError } from '@/lib/api';
import { Button, Card, Spinner } from '@/components/ui/primitives';
import type { Kit } from '@/core/types';

interface AdvanceResponse {
  status: 'running' | 'done' | 'failed';
  step: string;
  stepLabel: string;
  progress: number;
  error: { code: string; message: string } | null;
  events: { at: string; level: string; message: string }[];
  data: Kit | null;
}

/**
 * Generation is long, external and failure-prone, so it runs in slices: this
 * panel calls /advance repeatedly, showing the step the pipeline is actually on.
 * Closing the tab is safe — the work done so far is persisted, and reopening the
 * kit picks up from the step it stopped at.
 */
export function GenerationPanel({
  kitId,
  initialProgress,
  initialStepLabel,
  onDone,
  onFailed,
}: {
  kitId: string;
  initialProgress: number;
  initialStepLabel: string;
  onDone: (kit: Kit) => void;
  onFailed: (error: { code: string; message: string }) => void;
}) {
  const [progress, setProgress] = useState(initialProgress);
  const [stepLabel, setStepLabel] = useState(initialStepLabel);
  const [events, setEvents] = useState<AdvanceResponse['events']>([]);
  const [paused, setPaused] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    (async () => {
      while (!cancelled.current) {
        try {
          const result = await post<AdvanceResponse>(`/api/kits/${kitId}/advance`);
          if (cancelled.current) return;

          setProgress(result.progress);
          setStepLabel(result.stepLabel);
          setEvents((current) => [...current, ...result.events].slice(-8));

          if (result.status === 'done' && result.data) return onDone(result.data);
          if (result.status === 'failed') {
            return onFailed(result.error ?? { code: 'UNKNOWN', message: 'Generation failed.' });
          }
          // A slice that returns quickly must not turn into a spin loop.
          await new Promise((r) => setTimeout(r, 600));
        } catch (error) {
          if (cancelled.current) return;
          if (error instanceof ApiError && error.code === 'CONFLICT') {
            // Another tab is driving this kit; wait and look again.
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          setPaused(true);
          return;
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [kitId, onDone, onFailed]);

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Spinner label="Generating" />
        <div>
          <h2 className="font-medium">Building your kit</h2>
          <p className="text-sm text-muted">{stepLabel}…</p>
        </div>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={stepLabel}
      >
        <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>

      <p className="text-xs text-muted">
        This usually takes a minute or two. You can close this tab — progress is saved and picks up
        where it stopped.
      </p>

      {events.length > 0 ? (
        <ol className="space-y-1 rounded-lg bg-canvas p-3 text-xs" aria-live="polite">
          {events.map((event, index) => (
            <li key={index} className={event.level === 'warn' ? 'text-warn' : 'text-muted'}>
              {event.message}
            </li>
          ))}
        </ol>
      ) : null}

      {paused ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 p-3 text-sm">
          <span className="text-warn">Lost contact with the server while generating.</span>
          <Button size="sm" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
