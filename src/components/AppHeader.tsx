'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { Button } from '@/components/ui/primitives';

export function AppHeader({ email }: { email: string }) {
  const router = useRouter();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/kits" className="font-semibold tracking-tight">
          Interview Prep Kit
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{email}</span>
          <Button
            size="sm"
            onClick={async () => {
              await post('/api/auth/logout');
              router.push('/login');
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
