#!/usr/bin/env tsx
/**
 * Serves the mock company sites used by the tests, so the crawler and the batch
 * runner can be exercised locally: `npm run mocksite`, then point a case at
 * http://localhost:8099/acme/ (documents its hiring process, buried) or
 * http://localhost:8099/quietco/ (no hiring page anywhere).
 */
import { createSiteServer } from '../fixtures/mock-site';

const port = Number(process.env.MOCK_SITE_PORT ?? 8099);

createSiteServer().listen(port, () => {
  process.stderr.write(
    `Mock company sites on http://localhost:${port}/acme/ and http://localhost:${port}/quietco/\n`,
  );
});
