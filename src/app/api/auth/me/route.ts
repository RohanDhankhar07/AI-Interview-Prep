import { getCurrentUser } from '@/server/auth';
import { ok, withErrorHandling } from '@/server/http';

export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  return ok({ user: user ? { id: user.id, email: user.email } : null });
});
