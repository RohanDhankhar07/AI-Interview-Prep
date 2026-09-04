import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth';
import { AuthForm } from '@/components/AuthForm';

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/kits');
  return (
    <Suspense>
      <AuthForm mode="register" />
    </Suspense>
  );
}
