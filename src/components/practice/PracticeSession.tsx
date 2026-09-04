'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { post, ApiError } from '@/lib/api';
import { Badge, Button, Card, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { orderForSession, practiceStats, weakSpots, type Confidence, type PracticeRecord } from '@/core/practice';
import type { Kit } from '@/core/types';

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  1: 'Shaky',
  2: 'Nearly',
  3: 'Confident',
};

/**
 * Practice mode. Cards are ordered by the same rule the README defends: unseen
 * and least-confident first. Ratings are saved as they happen, so a session that
 * is abandoned halfway still counts.
 */
export function PracticeSession({ kitId, kit, initialPractice }: {
  kitId: string;
  kit: Kit;
  initialPractice: Record<string, PracticeRecord>;
}) {
  const toast = useToast();
  const [practice, setPractice] = useState(initialPractice);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);

  // The order is fixed when the session starts: re-sorting under the user's
  // feet as they answer would make the queue jump around.
  const session = useMemo(() => orderForSession(kit.flashcards, initialPractice), [kit.flashcards, initialPractice]);
  const stats = practiceStats(kit.flashcards, practice);
  const current = session[index];

  async function rate(confidence: Confidence) {
    if (!current) return;
    const card = current.card;
    const optimistic: PracticeRecord = {
      cardId: card.id,
      confidence,
      reps: (practice[card.id]?.reps ?? 0) + (confidence === 1 ? 0 : 1),
      lastSeenAt: new Date().toISOString(),
      dueAt: new Date().toISOString(),
    };
    setPractice((current) => ({ ...current, [card.id]: optimistic }));
    setRevealed(false);
    if (index + 1 >= session.length) setFinished(true);
    else setIndex((i) => i + 1);

    try {
      const result = await post<{ practice: Record<string, PracticeRecord> }>(
        `/api/kits/${kitId}/practice`,
        { cardId: card.id, confidence },
      );
      setPractice(result.practice);
    } catch (error) {
      toast.push(error instanceof ApiError ? error.message : 'That rating was not saved.', 'error');
    }
  }

  // Keyboard first: space reveals, 1-3 rate.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (finished || !current) return;
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        void rate(Number(event.key) as Confidence);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (kit.flashcards.length === 0) {
    return (
      <EmptyState
        title="No flashcards to practise"
        body="This kit has no cards yet. Add some in the builder, or regenerate the flashcard section."
        action={
          <Link href={`/kits/${kitId}`} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium">
            Back to the kit
          </Link>
        }
      />
    );
  }

  if (finished || !current) {
    return <SessionSummary kitId={kitId} kit={kit} practice={practice} onRestart={() => {
      setIndex(0);
      setRevealed(false);
      setFinished(false);
    }} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          Card {index + 1} of {session.length}
        </span>
        <span>
          {stats.seen} of {stats.total} covered · {stats.shaky} shaky
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={index}
        aria-valuemin={0}
        aria-valuemax={session.length}
        aria-label="Session progress"
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${(index / session.length) * 100}%` }}
        />
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{current.card.id}</Badge>
          <Badge tone={current.state === 'new' ? 'brand' : 'neutral'}>
            {current.state === 'new' ? 'New card' : current.state === 'due' ? 'Due for review' : 'Extra practice'}
          </Badge>
          {current.card.requirement_ids.map((id) => (
            <Badge key={id} title={kit.role.requirements.find((r) => r.id === id)?.text}>
              {id}
            </Badge>
          ))}
        </div>

        <p className="text-lg font-medium text-balance">{current.card.front}</p>

        {revealed ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-canvas p-4 whitespace-pre-wrap">{current.card.back}</p>
            <fieldset>
              <legend className="mb-2 text-sm text-muted">How did that go?</legend>
              <div className="flex flex-wrap gap-2">
                {([1, 2, 3] as Confidence[]).map((confidence) => (
                  <Button
                    key={confidence}
                    variant={confidence === 3 ? 'primary' : 'secondary'}
                    onClick={() => rate(confidence)}
                  >
                    {CONFIDENCE_LABELS[confidence]}
                    <span className="ml-1 text-xs opacity-60">{confidence}</span>
                  </Button>
                ))}
              </div>
            </fieldset>
          </div>
        ) : (
          <Button variant="primary" onClick={() => setRevealed(true)}>
            Show answer <span className="ml-1 text-xs opacity-60">space</span>
          </Button>
        )}
      </Card>

      <div className="flex justify-between">
        <Link href={`/kits/${kitId}`} className="text-sm text-muted hover:underline">
          Back to the kit
        </Link>
        <button
          className="text-sm text-muted hover:underline"
          onClick={() => (index + 1 >= session.length ? setFinished(true) : setIndex((i) => i + 1))}
        >
          Skip this card
        </button>
      </div>
    </div>
  );
}

/**
 * The weak-spots report — the creative feature. Practice happens on cards, but
 * an interviewer probes requirements, so confidence is rolled up to requirement
 * level and can be fed straight back into the (deterministic) schedule.
 */
function SessionSummary({
  kitId,
  kit,
  practice,
  onRestart,
}: {
  kitId: string;
  kit: Kit;
  practice: Record<string, PracticeRecord>;
  onRestart: () => void;
}) {
  const toast = useToast();
  const [replanning, setReplanning] = useState(false);
  const [replanned, setReplanned] = useState<string | null>(null);
  const stats = practiceStats(kit.flashcards, practice);
  const spots = weakSpots(kit.flashcards, kit.role.requirements, practice);
  const weakest = spots.filter((s) => s.cardsSeen > 0 && s.meanConfidence < 2.5);
  const untouched = spots.filter((s) => s.cardsSeen === 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card className="space-y-2 p-6">
        <h2 className="text-lg font-semibold">Session complete</h2>
        <p className="text-sm text-muted">
          You have now seen {stats.seen} of {stats.total} cards ({stats.coveragePercent}%).{' '}
          {stats.shaky > 0 ? `${stats.shaky} still feel shaky.` : 'Nothing is marked shaky.'}
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="primary" onClick={onRestart}>
            Go again
          </Button>
          <Link href={`/kits/${kitId}`} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium">
            Back to the kit
          </Link>
        </div>
      </Card>

      <Card className="space-y-3 p-6">
        <div>
          <h3 className="font-medium">Weak spots</h3>
          <p className="text-sm text-muted">
            Card confidence rolled up to the requirements an interviewer will actually probe.
          </p>
        </div>

        {weakest.length === 0 && untouched.length === 0 ? (
          <p className="text-sm text-good">Nothing looks weak yet. Come back after another session.</p>
        ) : (
          <ul className="space-y-2">
            {[...weakest, ...untouched].slice(0, 8).map((spot) => (
              <li key={spot.requirementId} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={spot.priority === 'must' ? 'bad' : 'warn'}>{spot.priority}</Badge>
                <span className="min-w-0 flex-1">{spot.text}</span>
                <span className="text-xs text-muted">
                  {spot.cardsSeen === 0
                    ? 'not practised'
                    : `confidence ${spot.meanConfidence.toFixed(1)} / 3 over ${spot.cardsSeen} card${
                        spot.cardsSeen === 1 ? '' : 's'
                      }`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-line pt-3">
          <Button
            disabled={replanning}
            onClick={async () => {
              setReplanning(true);
              try {
                const result = await post<{ summary: string }>(`/api/kits/${kitId}/regenerate`, {
                  section: 'schedule',
                });
                setReplanned(result.summary);
                toast.push('Schedule re-allocated around your weak spots.', 'success');
              } catch (error) {
                toast.push(error instanceof ApiError ? error.message : 'Could not re-plan.', 'error');
              } finally {
                setReplanning(false);
              }
            }}
          >
            {replanning ? 'Re-planning…' : 'Re-plan my schedule around these'}
          </Button>
          <p className="mt-2 text-xs text-muted">
            {replanned ??
              'Re-runs the same arithmetic that built the original plan, with the material you found hard pulled earlier.'}
          </p>
        </div>
      </Card>
    </div>
  );
}
