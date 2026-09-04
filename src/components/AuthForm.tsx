'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { post, ApiError } from '@/lib/api';
import { Button, Field, inputClass, Spinner } from '@/components/ui/primitives';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/kits';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await post(isRegister ? '/api/auth/register' : '/api/auth/login', { email, password });
      router.push(next);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VALIDATION_FAILED') {
        const issues = (caught.details as { issues?: { path: string; message: string }[] })?.issues ?? [];
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        setError('Check the highlighted fields.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isRegister ? 'Create an account' : 'Sign in'}
        </h1>
        <p className="text-sm text-muted">
          {isRegister
            ? 'Your kits are private to your account.'
            : 'Welcome back. Your kits are where you left them.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint={isRegister ? 'At least 10 characters.' : undefined}
          error={fieldErrors.password}
        >
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? <Spinner label="Signing in" /> : null}
          {isRegister ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="text-sm text-muted">
        {isRegister ? 'Already have an account? ' : 'No account yet? '}
        <Link className="font-medium text-brand underline" href={isRegister ? '/login' : '/register'}>
          {isRegister ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </div>
  );
}
