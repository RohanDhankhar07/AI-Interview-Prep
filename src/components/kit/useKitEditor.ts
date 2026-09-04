'use client';

import { useCallback, useRef, useState } from 'react';
import { patch, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import type { Operation } from '@/core/mutations';
import type { Kit } from '@/core/types';

/**
 * Edits apply locally first and are then confirmed by the server. If the server
 * refuses — a broken reference, a kit that would not validate, a lost session —
 * the previous state is put back and the user is told why. Nothing is left
 * looking saved when it is not.
 */
export function useKitEditor(kitId: string, initial: Kit) {
  const toast = useToast();
  const [kit, setKit] = useState<Kit>(initial);
  const [pending, setPending] = useState(0);
  // Guards against an older response overwriting a newer local edit.
  const sequence = useRef(0);

  const mutate = useCallback(
    async (operations: Operation[], optimistic?: (current: Kit) => Kit): Promise<boolean> => {
      const previous = kit;
      const ticket = ++sequence.current;
      if (optimistic) setKit(optimistic(previous));
      setPending((n) => n + 1);

      try {
        const result = await patch<{ data: Kit }>(`/api/kits/${kitId}/operations`, { operations });
        if (ticket === sequence.current) setKit(result.data);
        return true;
      } catch (error) {
        if (ticket === sequence.current) setKit(previous);
        toast.push(
          error instanceof ApiError ? error.message : 'That change could not be saved.',
          'error',
        );
        return false;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [kit, kitId, toast],
  );

  return { kit, setKit, mutate, saving: pending > 0 };
}
