'use client';

import { useState } from 'react';
import { QUESTION_CATEGORIES, type Kit, type Question, type QuestionCategory } from '@/core/types';
import type { Operation } from '@/core/mutations';
import { Badge, Button, Card, EmptyState, inputClass } from '@/components/ui/primitives';
import { InlineEdit } from './InlineEdit';
import { OriginBadge } from './OriginBadge';

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

interface Props {
  kit: Kit;
  mutate: (operations: Operation[], optimistic?: (kit: Kit) => Kit) => Promise<boolean>;
  regenerate: (section: string) => Promise<void>;
  regenerating: string | null;
}

export function QuestionsSection({ kit, mutate, regenerate, regenerating }: Props) {
  return (
    <section id="questions" aria-labelledby="questions-heading" className="space-y-6 scroll-mt-20">
      <div>
        <h2 id="questions-heading" className="text-lg font-semibold tracking-tight">
          Question bank
        </h2>
        <p className="mt-1 text-sm text-muted">
          Every question is linked to the requirements it covers. Editing or pinning a question keeps
          it through a regeneration of its category.
        </p>
      </div>

      {QUESTION_CATEGORIES.map((category) => (
        <CategoryBlock
          key={category}
          category={category}
          kit={kit}
          mutate={mutate}
          regenerate={regenerate}
          regenerating={regenerating}
        />
      ))}
    </section>
  );
}

function CategoryBlock({ category, kit, mutate, regenerate, regenerating }: Props & { category: QuestionCategory }) {
  const questions = kit.questions.filter((q) => q.category === category);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const busy = regenerating === `questions:${category}`;

  /** Moves one question within its category and returns the whole new order. */
  function orderAfterMove(fromId: string, toId: string): string[] {
    const ids = questions.map((q) => q.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1 || from === to) return kit.questions.map((q) => q.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);

    // Rebuild the global order, keeping other categories exactly where they are.
    const queue = [...ids];
    return kit.questions.map((q) => (q.category === category ? queue.shift()! : q.id));
  }

  function move(question: Question, direction: -1 | 1) {
    const index = questions.findIndex((q) => q.id === question.id);
    const target = questions[index + direction];
    if (!target) return;
    const ids = orderAfterMove(question.id, target.id);
    void mutate([{ type: 'question.reorder', ids }], (current) => ({
      ...current,
      questions: ids.map((id) => current.questions.find((q) => q.id === id)!),
    }));
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="flex items-center gap-2 font-medium">
          {CATEGORY_LABELS[category]}
          <span className="text-xs font-normal text-muted">
            {questions.length} question{questions.length === 1 ? '' : 's'}
          </span>
        </h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? 'Cancel' : 'Add question'}
          </Button>
          <Button
            size="sm"
            disabled={Boolean(regenerating)}
            onClick={() => regenerate(`questions:${category}`)}
            title="Rewrites only the generated questions in this category. Edited, hand-written and pinned questions are kept."
          >
            {busy ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </div>

      {adding ? (
        <AddQuestionForm
          category={category}
          kit={kit}
          onCancel={() => setAdding(false)}
          onAdd={async (question) => {
            const saved = await mutate([{ type: 'question.add', question }]);
            if (saved) setAdding(false);
          }}
        />
      ) : null}

      {questions.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={`No ${CATEGORY_LABELS[category].toLowerCase()} questions`}
            body={
              category === 'system-design'
                ? 'Nothing in this posting called for a design round. Add one by hand if you expect it.'
                : 'Add one by hand, or regenerate this category.'
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {questions.map((question, index) => (
            <QuestionRow
              key={question.id}
              question={question}
              kit={kit}
              mutate={mutate}
              isFirst={index === 0}
              isLast={index === questions.length - 1}
              onMove={move}
              draggable
              onDragStart={() => setDragId(question.id)}
              onDrop={() => {
                if (!dragId || dragId === question.id) return;
                const ids = orderAfterMove(dragId, question.id);
                setDragId(null);
                void mutate([{ type: 'question.reorder', ids }], (current) => ({
                  ...current,
                  questions: ids.map((id) => current.questions.find((q) => q.id === id)!),
                }));
              }}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

interface RowProps {
  question: Question;
  kit: Kit;
  mutate: Props['mutate'];
  isFirst: boolean;
  isLast: boolean;
  onMove: (question: Question, direction: -1 | 1) => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDrop?: () => void;
}

function QuestionRow({ question, kit, mutate, isFirst, isLast, onMove, onDragStart, onDrop }: RowProps) {
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const patchQuestion = (patch: Partial<Question>) =>
    mutate([{ type: 'question.update', id: question.id, patch: patch as never }], (current) => ({
      ...current,
      questions: current.questions.map((q) =>
        q.id === question.id ? { ...q, ...patch, origin: 'edited' } : q,
      ),
    }));

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDrop?.();
      }}
      className={`p-4 ${dragOver ? 'bg-brand-soft' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-2 cursor-grab text-muted select-none" title="Drag to reorder">
          ⠿
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          <InlineEdit
            label={`Question ${question.id}`}
            value={question.prompt}
            multiline
            rows={2}
            className="font-medium"
            onSave={(prompt) => patchQuestion({ prompt })}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{question.id}</Badge>
            <OriginBadge origin={question.origin} pinned={question.pinned} />
            <Badge tone={question.difficulty === 3 ? 'warn' : 'neutral'}>
              Difficulty {question.difficulty}
            </Badge>
            {question.requirement_ids.length === 0 ? (
              <Badge tone="warn" title="This question is not linked to any requirement">
                Unlinked
              </Badge>
            ) : (
              question.requirement_ids.map((id) => (
                <Badge key={id} tone="brand" title={kit.role.requirements.find((r) => r.id === id)?.text}>
                  {id}
                </Badge>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? 'Hide answer outline' : 'Answer outline'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMove(question, -1)}
              disabled={isFirst}
              aria-label={`Move question ${question.id} up`}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMove(question, 1)}
              disabled={isLast}
              aria-label={`Move question ${question.id} down`}
            >
              ↓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                mutate([{ type: 'question.pin', id: question.id, pinned: !question.pinned }], (current) => ({
                  ...current,
                  questions: current.questions.map((q) =>
                    q.id === question.id ? { ...q, pinned: !q.pinned } : q,
                  ),
                }))
              }
              aria-pressed={question.pinned}
            >
              {question.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (!confirm('Delete this question?')) return;
                void mutate([{ type: 'question.delete', id: question.id }], (current) => ({
                  ...current,
                  questions: current.questions.filter((q) => q.id !== question.id),
                }));
              }}
              aria-label={`Delete question ${question.id}`}
            >
              Delete
            </Button>
          </div>

          {open ? (
            <div className="space-y-3 rounded-lg bg-canvas p-3">
              <InlineEdit
                label={`Answer outline for ${question.id}`}
                value={question.answer_outline}
                multiline
                rows={5}
                placeholder="What a strong answer covers…"
                onSave={(answer_outline) => patchQuestion({ answer_outline })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">
                  Difficulty
                  <select
                    className={`${inputClass} mt-1`}
                    value={question.difficulty}
                    onChange={(e) => patchQuestion({ difficulty: Number(e.target.value) as 1 | 2 | 3 })}
                  >
                    <option value={1}>1 — warm-up</option>
                    <option value={2}>2 — standard</option>
                    <option value={3}>3 — hardest expected</option>
                  </select>
                </label>

                <label className="block text-xs font-medium">
                  Category
                  <select
                    className={`${inputClass} mt-1`}
                    value={question.category}
                    onChange={(e) =>
                      mutate(
                        [
                          {
                            type: 'question.move',
                            id: question.id,
                            category: e.target.value as QuestionCategory,
                          },
                        ],
                        (current) => ({
                          ...current,
                          questions: current.questions.map((q) =>
                            q.id === question.id
                              ? { ...q, category: e.target.value as QuestionCategory, origin: 'edited' }
                              : q,
                          ),
                        }),
                      )
                    }
                  >
                    {QUESTION_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <RequirementLinks
                selected={question.requirement_ids}
                kit={kit}
                onChange={(requirement_ids) => patchQuestion({ requirement_ids })}
              />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function RequirementLinks({
  selected,
  kit,
  onChange,
}: {
  selected: string[];
  kit: Kit;
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium">Requirements covered</legend>
      <div className="flex flex-wrap gap-1.5">
        {kit.role.requirements.map((requirement) => {
          const checked = selected.includes(requirement.id);
          return (
            <label
              key={requirement.id}
              className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] ${
                checked ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted'
              }`}
              title={requirement.text}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked ? selected.filter((id) => id !== requirement.id) : [...selected, requirement.id],
                  )
                }
              />
              {requirement.id} · {requirement.text.slice(0, 32)}
              {requirement.text.length > 32 ? '…' : ''}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function AddQuestionForm({
  category,
  kit,
  onAdd,
  onCancel,
}: {
  category: QuestionCategory;
  kit: Kit;
  onAdd: (question: {
    prompt: string;
    answer_outline: string;
    category: QuestionCategory;
    difficulty: number;
    requirement_ids: string[];
  }) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [outline, setOutline] = useState('');
  const [ids, setIds] = useState<string[]>([]);

  return (
    <form
      className="space-y-3 border-b border-line bg-canvas p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        onAdd({
          prompt: prompt.trim(),
          answer_outline: outline.trim(),
          category,
          difficulty: 2,
          requirement_ids: ids,
        });
      }}
    >
      <label className="block text-xs font-medium">
        Question
        <textarea
          autoFocus
          rows={2}
          className={`${inputClass} mt-1`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="The question you expect to be asked…"
        />
      </label>
      <label className="block text-xs font-medium">
        Answer outline
        <textarea
          rows={3}
          className={`${inputClass} mt-1`}
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
          placeholder="What you want to remember to say…"
        />
      </label>
      <RequirementLinks selected={ids} kit={kit} onChange={setIds} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!prompt.trim()}>
          Add question
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
