'use client';

import { Badge } from '@/components/ui/primitives';

/**
 * Provenance made visible: the user can see at a glance what a regeneration
 * would replace and what it would leave alone.
 */
export function OriginBadge({ origin, pinned }: { origin?: string; pinned?: boolean }) {
  if (pinned) return <Badge tone="brand" title="Pinned — a regeneration will keep this">Pinned</Badge>;
  if (origin === 'manual') return <Badge tone="good" title="You wrote this — regeneration keeps it">Yours</Badge>;
  if (origin === 'edited') return <Badge tone="good" title="You edited this — regeneration keeps it">Edited</Badge>;
  return (
    <Badge title="Generated and untouched — a regeneration of this section will replace it">
      Generated
    </Badge>
  );
}
