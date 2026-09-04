import { z } from 'zod';
import { createSession, hashPassword } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { ConflictError, ok, readJson, withErrorHandling } from '@/server/http';

const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

export const POST = withErrorHandling(async (request: Request) => {
  const { email, password } = await readJson(request, Body);
  const { users } = getRepositories();

  if (await users.findByEmail(email)) {
    throw new ConflictError('An account with that email already exists.');
  }

  const user = await users.create({
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  await createSession(user.id);
  return ok({ user: { id: user.id, email: user.email } }, { status: 201 });
});
