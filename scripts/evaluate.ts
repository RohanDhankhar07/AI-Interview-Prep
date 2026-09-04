#!/usr/bin/env tsx
/**
 * Batch entry point (Section 9).
 *
 *   npm run evaluate -- --input cases.json --output kits.json
 *
 * Runs the same pipeline the web app runs — src/core/pipeline — over a file of
 * cases and writes Appendix B. One failing case never stops the run.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { runPipeline, type PipelineState } from '../src/core/pipeline';
import { validateKit } from '../src/core/validate';
import type { Kit } from '../src/core/types';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string().default(''),
  company_url: z.string().default(''),
  days: z.coerce.number().int().positive().default(5),
});
type Case = z.infer<typeof CaseSchema>;

interface OutputEntry {
  id: string;
  status: 'ok' | 'failed';
  kit: Kit | null;
  error: { code: string; message: string } | null;
}

function parseArgs(argv: string[]): { input: string; output: string; concurrency: number } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [flag, inline] = arg.replace(/^--/, '').split('=');
    args.set(flag, inline ?? (argv[i + 1]?.startsWith('--') ? 'true' : (argv[++i] ?? 'true')));
  }
  const input = args.get('input');
  const output = args.get('output');
  if (!input || !output) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]');
    process.exit(2);
  }
  return {
    input: resolve(input),
    output: resolve(output),
    concurrency: Math.max(1, Math.min(4, Number(args.get('concurrency') ?? 2))),
  };
}

async function runCase(testCase: Case, index: number, total: number): Promise<OutputEntry> {
  const started = Date.now();
  const log = (message: string) =>
    process.stderr.write(`[${testCase.id}] ${message}\n`);

  log(`(${index + 1}/${total}) starting — ${testCase.days} day(s), ${testCase.jd.length} jd chars`);

  let state: PipelineState;
  try {
    state = await runPipeline(
      { jd: testCase.jd, companyUrl: testCase.company_url, days: testCase.days },
      {
        totalBudgetMs: Number(process.env.CASE_BUDGET_MS ?? 240_000),
        onEvent: (event) => {
          if (event.level !== 'info') log(`${event.level}: ${event.message}`);
        },
      },
    );
  } catch (error) {
    // A throw here is a bug or an unrecoverable environment problem; record it and carry on.
    log(`crashed: ${(error as Error).message}`);
    return {
      id: testCase.id,
      status: 'failed',
      kit: null,
      error: { code: 'PIPELINE_CRASHED', message: (error as Error).message },
    };
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (state.status !== 'done') {
    log(`failed in ${seconds}s: ${state.error?.code} ${state.error?.message}`);
    return {
      id: testCase.id,
      status: 'failed',
      kit: null,
      error: state.error ?? { code: 'UNKNOWN', message: 'Pipeline did not complete.' },
    };
  }

  const validation = validateKit(state.kit);
  if (!validation.ok) {
    log(`failed validation in ${seconds}s: ${validation.errors.join('; ')}`);
    return {
      id: testCase.id,
      status: 'failed',
      kit: null,
      error: { code: 'INVALID_KIT', message: validation.errors.join('; ') },
    };
  }

  const kit = validation.kit!;
  log(
    `ok in ${seconds}s — ${kit.role.requirements.length} requirements, ${kit.questions.length} questions, ` +
      `${kit.flashcards.length} cards, ${kit.schedule.days.length} days, ` +
      `${kit.coverage.uncovered_requirement_ids.length} uncovered after ${kit.coverage.passes} pass(es)`,
  );
  return { id: testCase.id, status: 'ok', kit, error: null };
}

/** Fixed-size worker pool: cases overlap, but not so many that free-tier limits bite. */
async function runPool(cases: Case[], concurrency: number): Promise<OutputEntry[]> {
  const results: OutputEntry[] = new Array(cases.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (cursor < cases.length) {
      const index = cursor++;
      results[index] = await runCase(cases[index], index, cases.length);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const { input, output, concurrency } = parseArgs(process.argv.slice(2));

  // The batch runner talks to whatever host the cases name, including localhost.
  process.env.ALLOW_PRIVATE_NETWORK ??= 'true';

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(input, 'utf8'));
  } catch (error) {
    console.error(`Could not read cases from ${input}: ${(error as Error).message}`);
    process.exit(2);
  }

  const parsed = z.array(CaseSchema).safeParse(raw);
  if (!parsed.success) {
    console.error(`Input must be an array of { id, jd, company_url, days }: ${parsed.error.message}`);
    process.exit(2);
  }

  const started = Date.now();
  process.stderr.write(`Running ${parsed.data.length} case(s) with concurrency ${concurrency}\n`);
  const kits = await runPool(parsed.data, concurrency);

  const payload = {
    version: '1.0',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    kits,
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const ok = kits.filter((k) => k.status === 'ok').length;
  process.stderr.write(
    `\nWrote ${output} — ${ok}/${kits.length} ok in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
  // A failed case is a recorded outcome, not a failed run: exit 0 so CI keeps the output.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
