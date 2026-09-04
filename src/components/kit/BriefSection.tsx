'use client';

import type { Kit } from '@/core/types';
import type { Operation } from '@/core/mutations';
import { Button, Card } from '@/components/ui/primitives';
import { InlineEdit } from './InlineEdit';
import { OriginBadge } from './OriginBadge';

export function BriefSection({
  kit,
  mutate,
  regenerate,
  regenerating,
}: {
  kit: Kit;
  mutate: (ops: Operation[], optimistic?: (kit: Kit) => Kit) => Promise<boolean>;
  regenerate: (section: string) => Promise<void>;
  regenerating: string | null;
}) {
  const brief = kit.company_brief;
  const busy = regenerating === 'company_brief';

  const patchBrief = (patch: { summary?: string; what_they_do?: string }) =>
    mutate([{ type: 'brief.update', patch }], (current) => ({
      ...current,
      company_brief: { ...current.company_brief, ...patch, origin: 'edited' },
    }));

  return (
    <section id="brief" aria-labelledby="brief-heading" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="brief-heading" className="text-lg font-semibold tracking-tight">
          Company brief
        </h2>
        <div className="flex items-center gap-2">
          <OriginBadge origin={brief.origin} pinned={brief.pinned} />
          <Button
            size="sm"
            onClick={() =>
              mutate([{ type: 'brief.pin', pinned: !brief.pinned }], (current) => ({
                ...current,
                company_brief: { ...current.company_brief, pinned: !current.company_brief.pinned },
              }))
            }
            aria-pressed={brief.pinned}
            title="A pinned brief is never overwritten, even by an explicit regeneration"
          >
            {brief.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            size="sm"
            disabled={Boolean(regenerating) || brief.pinned}
            onClick={() => regenerate('company_brief')}
            title={brief.pinned ? 'Unpin the brief first' : 'Re-crawls the company site and rewrites the brief'}
          >
            {busy ? 'Re-crawling…' : 'Regenerate'}
          </Button>
        </div>
      </div>

      <Card className="space-y-3 p-4">
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">Summary</h3>
          <InlineEdit
            label="Company summary"
            value={brief.summary}
            multiline
            rows={3}
            placeholder="What a candidate should know…"
            onSave={(summary) => patchBrief({ summary })}
          />
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">What they do</h3>
          <InlineEdit
            label="What they do"
            value={brief.what_they_do}
            multiline
            rows={4}
            onSave={(what_they_do) => patchBrief({ what_they_do })}
          />
        </div>
        {brief.sources.length > 0 ? (
          <div className="border-t border-line pt-3">
            <h3 className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">Sources</h3>
            <ul className="space-y-1 text-sm">
              {brief.sources.map((source) => (
                <li key={source}>
                  <a
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all text-brand underline"
                  >
                    {source}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
