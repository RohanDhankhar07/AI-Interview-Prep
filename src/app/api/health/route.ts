import { activeSearchProvider } from '@/core/net/search';
import { isDatabaseConfigured } from '@/server/db';
import { ok, withErrorHandling } from '@/server/http';

/**
 * Deployment sanity check: says which pieces are configured without ever
 * revealing a value. The usual first question after a deploy is "did the
 * environment variables land?", and this answers it in one request.
 */
export const GET = withErrorHandling(async () => {
  const provider = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
  const keyPresent = Boolean(
    process.env.LLM_API_KEY ??
      process.env.GROQ_API_KEY ??
      process.env.GEMINI_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      process.env.CEREBRAS_API_KEY,
  );

  return ok({
    ok: true,
    time: new Date().toISOString(),
    database: isDatabaseConfigured() ? 'configured' : 'in-memory (development only)',
    auth_secret: (process.env.AUTH_SECRET ?? '').length >= 32 ? 'configured' : 'missing or too short',
    llm: { provider, key: provider === 'mock' ? 'not needed' : keyPresent ? 'configured' : 'missing' },
    search: activeSearchProvider(),
    private_network_fetches: process.env.NODE_ENV !== 'production' || process.env.ALLOW_PRIVATE_NETWORK === 'true',
  });
});
