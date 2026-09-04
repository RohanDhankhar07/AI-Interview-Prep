import { z } from 'zod';
import { createSession, verifyPassword } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { fail, ok, readJson, withErrorHandling } from '@/server/http';

const Body = z.object({ email: z.string().email().max(200), password: z.string().max(200) });

export const POST = withErrorHandling(async (request: Request) => {
  const { email, password } = await readJson(request, Body);
  const user = await getRepositories().users.findByEmail(email);

  // Same response either way: never reveal which half was wrong.
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) return fail('INVALID_CREDENTIALS', 'That email and password do not match.', 401);

  await createSession(user.id);
  return ok({ user: { id: user.id, email: user.email } });
});
