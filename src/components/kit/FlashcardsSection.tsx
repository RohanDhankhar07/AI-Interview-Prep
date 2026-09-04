'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Kit } from '@/core/types';
import type { Operation } from '@/core/mutations';
import { Badge, Button, Card, EmptyState, inputClass } from '@/components/ui/primitives';
import { InlineEdit } from './InlineEdit';
import { OriginBadge } from './OriginBadge';

export function FlashcardsSection({
  kit,
  kitId,
  mutate,
  regenerate,
  regenerating,
}: {
  kit: Kit;
  kitId: string;
  mutate: (ops: Operation[], optimistic?: (kit: Kit) => Kit) => Promise<boolean>;
  regenerate: (section: string) => Promise<void>;
  regenerating: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  return (
    <section id="flashcards" aria-labelledby="flashcards-heading" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="flashcards-heading" className="text-lg font-semibold tracking-tight">
          Flashcards <span className="text-sm font-normal text-muted">({kit.flashcards.length})</span>
        </h2>
        <div className="flex gap-2">
          <Link
            href={`/kits/${kitId}/practice`}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white dark:text-slate-900"
          >
            Practise these
          </Link>
          <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? 'Cancel' : 'Add card'}
          </Button>
          <Button size="sm" disabled={Boolean(regenerating)} onClick={() => regenerate('flashcards')}>
            {regenerating === 'flashcards' ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </div>

      {adding ? (
        <Card className="space-y-2 p-4">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!front.trim()) return;
              void mutate([
                { type: 'flashcard.add', flashcard: { front: front.trim(), back: back.trim(), requirement_ids: [] } },
              ]);
              setFront('');
              setBack('');
              setAdding(false);
            }}
          >
            <input
              autoFocus
              className={inputClass}
              placeholder="Front — the prompt"
              aria-label="Card front"
              value={front}
              onChange={(e) => setFront(e.target.value)}
            />
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Back — what you want to recall"
              aria-label="Card back"
              value={back}
              onChange={(e) => setBack(e.target.value)}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!front.trim()}>
              Add card
            </Button>
          </form>
        </Card>
      ) : null}

      {kit.flashcards.length === 0 ? (
        <EmptyState
          title="No flashcards"
          body="Flashcard generation did not produce anything for this kit. Add cards by hand or regenerate."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {kit.flashcards.map((flashcard) => (
            <Card as="li" key={flashcard.id} className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge>{flashcard.id}</Badge>
                <div className="flex items-center gap-1">
                  <OriginBadge origin={flashcard.origin} pinned={flashcard.pinned} />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={flashcard.pinned}
                    onClick={() =>
                      mutate([{ type: 'flashcard.pin', id: flashcard.id, pinned: !flashcard.pinned }], (current) => ({
                        ...current,
                        flashcards: current.flashcards.map((f) =>
                          f.id === flashcard.id ? { ...f, pinned: !f.pinned } : f,
                        ),
                      }))
                    }
                  >
                    {flashcard.pinned ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete card ${flashcard.id}`}
                    onClick={() =>
                      mutate([{ type: 'flashcard.delete', id: flashcard.id }], (current) => ({
                        ...current,
                        flashcards: current.flashcards.filter((f) => f.id !== flashcard.id),
                      }))
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <InlineEdit
                label={`Front of ${flashcard.id}`}
                value={flashcard.front}
                multiline
                rows={2}
                className="font-medium"
                onSave={(front) =>
                  mutate([{ type: 'flashcard.update', id: flashcard.id, patch: { front } }], (current) => ({
                    ...current,
                    flashcards: current.flashcards.map((f) =>
                      f.id === flashcard.id ? { ...f, front, origin: 'edited' } : f,
                    ),
                  }))
                }
              />
              <InlineEdit
                label={`Back of ${flashcard.id}`}
                value={flashcard.back}
                multiline
                rows={3}
                className="text-muted"
                onSave={(back) =>
                  mutate([{ type: 'flashcard.update', id: flashcard.id, patch: { back } }], (current) => ({
                    ...current,
                    flashcards: current.flashcards.map((f) =>
                      f.id === flashcard.id ? { ...f, back, origin: 'edited' } : f,
                    ),
                  }))
                }
              />
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}
