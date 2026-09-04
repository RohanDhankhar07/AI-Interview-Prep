import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth';
import { AppHeader } from '@/components/AppHeader';

export default async function KitsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh">
      <AppHeader email={user.email} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
