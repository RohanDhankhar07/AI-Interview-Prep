'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, ApiError } from '@/lib/api';
import { Button, Field, inputClass, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';

/**
 * One role, or several. A file of description-and-company pairs fills the same
 * rows the user could type by hand, so the batch path is not a separate screen
 * with separate rules.
 */

interface Row {
  key: string;
  jd: string;
  companyUrl: string;
  days: number;
}

const emptyRow = (): Row => ({ key: crypto.randomUUID(), jd: '', companyUrl: '', days: 5 });

export function NewKitForm() {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function validate(): boolean {
    const found: Record<string, string> = {};
    rows.forEach((row, index) => {
      if (row.jd.trim().length < 10) found[`${row.key}.jd`] = 'Paste the job description.';
      if (!row.companyUrl.trim()) found[`${row.key}.companyUrl`] = 'Add the company website.';
      if (row.days < 1 || row.days > 90) found[`${row.key}.days`] = 'Between 1 and 90 days.';
      void index;
    });
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function onFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown[] }).cases;
      if (!Array.isArray(list) || list.length === 0) throw new Error('empty');

      const imported = list.slice(0, 20).map((item) => {
        const record = item as Record<string, unknown>;
        return {
          key: crypto.randomUUID(),
          jd: String(record.jd ?? record.job_description ?? ''),
          companyUrl: String(record.company_url ?? record.companyUrl ?? ''),
          days: Number(record.days ?? 5) || 5,
        };
      });
      setRows(imported);
      toast.push(`Loaded ${imported.length} role(s) from ${file.name}.`, 'success');
    } catch {
      toast.push('That file could not be read. Expect JSON: [{ "jd", "company_url", "days" }].', 'error');
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = rows.map((row) => ({
        jd: row.jd.trim(),
        companyUrl: row.companyUrl.trim(),
        days: row.days,
      }));
      const result = await post<{ kits: { id: string; duplicate: boolean }[] }>(
        '/api/kits',
        rows.length === 1 ? payload[0] : { cases: payload },
      );

      const duplicates = result.kits.filter((k) => k.duplicate).length;
      if (duplicates) {
        toast.push(
          `${duplicates} of these was already in your kits — opening the existing one instead of generating it again.`,
        );
      }
      router.push(result.kits.length === 1 ? `/kits/${result.kits[0].id}` : '/kits');
      router.refresh();
    } catch (error) {
      toast.push(error instanceof ApiError ? error.message : 'Could not create the kit.', 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {rows.map((row, index) => (
        <div key={row.key} className="space-y-4 rounded-xl border border-line bg-surface p-4">
          {rows.length > 1 ? (
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Role {index + 1}</h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                Remove
              </Button>
            </div>
          ) : null}

          <Field
            label="Job description"
            htmlFor={`jd-${row.key}`}
            hint="Paste the posting text. Job boards block scrapers, so this part is copy and paste."
            error={errors[`${row.key}.jd`]}
          >
            <textarea
              id={`jd-${row.key}`}
              rows={rows.length > 1 ? 5 : 10}
              className={`${inputClass} font-mono text-[13px] leading-relaxed`}
              value={row.jd}
              onChange={(e) => update(row.key, { jd: e.target.value })}
              placeholder="Senior Backend Engineer&#10;&#10;Requirements:&#10;- 5+ years…"
              aria-invalid={Boolean(errors[`${row.key}.jd`])}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field
              label="Company website"
              htmlFor={`url-${row.key}`}
              hint="The homepage is enough — we find the rest."
              error={errors[`${row.key}.companyUrl`]}
            >
              <input
                id={`url-${row.key}`}
                type="url"
                inputMode="url"
                className={inputClass}
                placeholder="https://example.com"
                value={row.companyUrl}
                onChange={(e) => update(row.key, { companyUrl: e.target.value })}
                aria-invalid={Boolean(errors[`${row.key}.companyUrl`])}
              />
            </Field>

            <Field label="Days until the interview" htmlFor={`days-${row.key}`} error={errors[`${row.key}.days`]}>
              <div className="flex items-center gap-2">
                <input
                  id={`days-${row.key}`}
                  type="number"
                  min={1}
                  max={90}
                  className={`${inputClass} w-24`}
                  value={row.days}
                  onChange={(e) => update(row.key, { days: Number(e.target.value) })}
                />
                <div className="hidden gap-1 sm:flex">
                  {[1, 3, 7, 14].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      onClick={() => update(row.key, { days: preset })}
                      aria-label={`${preset} days`}
                    >
                      {preset}d
                    </Button>
                  ))}
                </div>
              </div>
            </Field>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Spinner label="Creating" /> : null}
          {rows.length > 1 ? `Build ${rows.length} kits` : 'Build the kit'}
        </Button>
        <Button type="button" onClick={() => setRows((current) => [...current, emptyRow()])}>
          Add another role
        </Button>
        <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
          Upload a file of roles
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Upload a JSON file of job descriptions and company URLs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </form>
  );
}
