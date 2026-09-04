'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Inline editing that does not round-trip on every keystroke: typing is local,
 * a save fires 900ms after you stop (or immediately on blur), and an incoming
 * value only replaces yours while the field is not focused.
 */

const DEBOUNCE_MS = 900;

interface InlineProps {
  value: string;
  onSave: (value: string) => void | Promise<unknown>;
  label: string;
  placeholder?: string;
  className?: string;
  rows?: number;
  multiline?: boolean;
}

export function InlineEdit({
  value,
  onSave,
  label,
  placeholder,
  className = '',
  rows = 3,
  multiline = false,
}: InlineProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accept server updates only when the user is not mid-edit.
  useEffect(() => {
    if (!focused && !dirty) setDraft(value);
  }, [value, focused, dirty]);

  const commit = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next === value) {
      setDirty(false);
      return;
    }
    setDirty(false);
    void onSave(next);
  };

  const onChange = (next: string) => {
    setDraft(next);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  };

  const shared = {
    value: draft,
    'aria-label': label,
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      commit(draft);
    },
    className: `w-full resize-y rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none transition ${
      dirty ? 'border-brand/60' : 'border-transparent hover:border-line focus:border-brand'
    } ${className}`,
  };

  return multiline ? (
    <textarea {...shared} rows={rows} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input
      {...shared}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(draft);
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setDraft(value);
          setDirty(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
