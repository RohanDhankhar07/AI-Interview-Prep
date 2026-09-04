'use client';

import { useState } from 'react';
import { REQUIREMENT_KINDS, type Kit, type Requirement } from '@/core/types';
import type { Operation } from '@/core/mutations';
import { Badge, Button, Card, inputClass } from '@/components/ui/primitives';
import { InlineEdit } from './InlineEdit';

/** Requirements are the spine of the kit: coverage, questions and the schedule all hang off them. */
export function RequirementsSection({
  kit,
  mutate,
}: {
  kit: Kit;
  mutate: (ops: Operation[], optimistic?: (kit: Kit) => Kit) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const coverage = new Map<string, number>();
  for (const question of kit.questions) {
    for (const id of question.requirement_ids) coverage.set(id, (coverage.get(id) ?? 0) + 1);
  }

  const patchRequirement = (requirement: Requirement, patch: Partial<Requirement>) =>
    mutate([{ type: 'requirement.update', id: requirement.id, patch: patch as never }], (current) => ({
      ...current,
      role: {
        ...current.role,
        requirements: current.role.requirements.map((r) =>
          r.id === requirement.id ? { ...r, ...patch, origin: 'edited' } : r,
        ),
      },
    }));

  return (
    <section id="role" aria-labelledby="role-heading" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="role-heading" className="text-lg font-semibold tracking-tight">
            Role and requirements
          </h2>
          <p className="mt-1 text-sm text-muted">
            {kit.role.title}
            {kit.role.seniority ? ` · ${kit.role.seniority}` : ''} ·{' '}
            {kit.role.requirements.filter((r) => r.priority === 'must').length} must-have of{' '}
            {kit.role.requirements.length}
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? 'Cancel' : 'Add requirement'}
        </Button>
      </div>

      {kit.role.responsibilities.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Responsibilities</h3>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {kit.role.responsibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {adding ? (
        <Card className="p-4">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void mutate([
                {
                  type: 'requirement.add',
                  requirement: { text: text.trim(), kind: 'technical', priority: 'must' },
                },
              ]);
              setText('');
              setAdding(false);
            }}
          >
            <input
              autoFocus
              className={`${inputClass} flex-1`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="A requirement the posting mentions that we missed…"
              aria-label="New requirement"
            />
            <Button type="submit" variant="primary" size="sm">
              Add
            </Button>
          </form>
        </Card>
      ) : null}

      {kit.role.requirements.length === 0 ? (
        <Card className="p-4 text-sm text-muted">
          No requirements could be extracted from this posting. Add the ones you can see, or paste a
          fuller description into a new kit.
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {kit.role.requirements.map((requirement) => {
            const count = coverage.get(requirement.id) ?? 0;
            return (
              <div key={requirement.id} className="flex flex-wrap items-center gap-2 p-3">
                <Badge>{requirement.id}</Badge>
                <div className="min-w-[14rem] flex-1">
                  <InlineEdit
                    label={`Requirement ${requirement.id}`}
                    value={requirement.text}
                    onSave={(next) => patchRequirement(requirement, { text: next })}
                  />
                </div>
                <select
                  aria-label={`Priority of ${requirement.id}`}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                  value={requirement.priority}
                  onChange={(e) => patchRequirement(requirement, { priority: e.target.value as 'must' | 'nice' })}
                >
                  <option value="must">must</option>
                  <option value="nice">nice</option>
                </select>
                <select
                  aria-label={`Kind of ${requirement.id}`}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                  value={requirement.kind}
                  onChange={(e) => patchRequirement(requirement, { kind: e.target.value as Requirement['kind'] })}
                >
                  {REQUIREMENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
                <Badge tone={count === 0 ? 'bad' : 'good'} title={`${count} question(s) cover this`}>
                  {count === 0 ? 'no question' : `${count} question${count === 1 ? '' : 's'}`}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete requirement ${requirement.id}`}
                  onClick={() => {
                    if (!confirm(`Delete ${requirement.id}? Questions linked to it stay, unlinked.`)) return;
                    void mutate([{ type: 'requirement.delete', id: requirement.id }]);
                  }}
                >
                  Delete
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
