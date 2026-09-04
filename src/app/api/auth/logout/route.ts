import { destroySession } from '@/server/auth';
import { ok, withErrorHandling } from '@/server/http';

export const POST = withErrorHandling(async () => {
  await destroySession();
  return ok({ ok: true });
});
