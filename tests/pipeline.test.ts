import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { runPipeline, advance, createInitialState, progressPercent } from '../src/core/pipeline';
import { validateKit, uncoveredMustHaves } from '../src/core/validate';
import { checkCoverage } from '../src/core/coverage';
import { robotsCacheClear } from '../src/core/net/robots';
import { installMockLlm, uninstallMockLlm } from './mock-llm';
import { toState } from '../src/server/kitService';
import { kit as kitFixture } from './helpers';

/**
 * End-to-end: a local company site plus a deterministic model, exercising
 * retrieval, the coverage loop, allocation and validation together.
 */

const SENIOR_JD = `Senior Backend Engineer

Requirements:
- 5+ years with Go and TypeScript
- Strong PostgreSQL experience
- Event-driven systems using Kafka
- Running services on Kubernetes
- Mentor two or three mid-level engineers
- Take part in on-call and lead incident reviews

Nice to have:
- Experience with Terraform`;

let server: Server;
let base: string;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_NETWORK = 'true';
  process.env.SEARCH_DISABLED = 'true';
  const { createSiteServer: makeSite } = await import('../fixtures/mock-site');
  server = makeSite();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
  delete process.env.SEARCH_DISABLED;
});

afterEach(() => {
  uninstallMockLlm();
  robotsCacheClear();
});

describe('runPipeline against a company that documents its hiring process', () => {
  it('produces a valid kit that covers every must-have', async () => {
    installMockLlm();
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 5 });

    expect(state.status).toBe('done');
    const validation = validateKit(state.kit);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    const kit = state.kit;
    expect(uncoveredMustHaves(kit)).toEqual([]);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.schedule.days).toHaveLength(5);
    expect(kit.flashcards.length).toBeGreaterThan(0);
  });

  it('finds the hiring page that is only reachable by a relative link', async () => {
    installMockLlm();
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 3 });

    expect(state.kit.research!.crawled_pages).toBeGreaterThan(1);
    expect(state.kit.research!.hiring_process_found).toBe(true);
    expect(state.kit.research!.hiring_process_urls.join(' ')).toContain('how-we-hire');
    expect(state.kit.source.pages_used.length).toBeGreaterThan(1);
  });

  it('generates each question category in its own call', async () => {
    const { calls } = installMockLlm();
    await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 3 });
    expect(calls.filter((c) => c === 'questions').length).toBeGreaterThanOrEqual(2);
  });

  it('runs a second pass and closes a coverage gap', async () => {
    installMockLlm({ dropOnFirstPass: ['r1', 'r2'] });
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 4 });

    expect(state.kit.coverage.passes).toBeGreaterThanOrEqual(1);
    expect(state.kit.coverage.uncovered_requirement_ids).toEqual([]);
    const report = checkCoverage(state.kit.role.requirements, state.kit.questions);
    expect(report.uncovered_must_ids).toEqual([]);
    // The gap pass ran because the first pass left something uncovered.
    expect(state.events.some((e) => e.message.includes('gap pass') || e.message.includes('Gap pass'))).toBe(true);
  });
});

describe('runPipeline against a company with no hiring page', () => {
  it('says so honestly instead of inventing a process', async () => {
    installMockLlm();
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/quietco/`, days: 3 });

    expect(state.status).toBe('done');
    expect(state.kit.research!.hiring_process_found).toBe(false);
    expect(state.kit.research!.notes.join(' ')).toMatch(/no page describing the hiring process/i);
    expect(validateKit(state.kit).ok).toBe(true);
  });
});

describe('runPipeline when the company site cannot be reached', () => {
  it('still produces a valid kit and records the failure', async () => {
    installMockLlm();
    const state = await runPipeline({
      jd: SENIOR_JD,
      companyUrl: `${base}/does-not-exist/`,
      days: 2,
    });

    expect(state.status).toBe('done');
    expect(validateKit(state.kit).ok).toBe(true);
    expect(state.kit.research!.skipped_sources.length).toBeGreaterThan(0);
    expect(state.kit.research!.notes.join(' ')).toMatch(/could not be reached/i);
    expect(state.kit.company_brief.what_they_do).toMatch(/unknown/i);
    expect(uncoveredMustHaves(state.kit)).toEqual([]);
  });
});

describe('runPipeline with a two-line job description', () => {
  it('produces a thin kit that says it is thin, without inventing requirements', async () => {
    installMockLlm();
    const state = await runPipeline({
      jd: 'Full Stack Developer. React and Node. Apply within.',
      companyUrl: `${base}/quietco/`,
      days: 3,
    });

    expect(state.status).toBe('done');
    expect(state.kit.role.requirements.length).toBeLessThanOrEqual(3);
    expect(state.kit.research!.notes.join(' ')).toMatch(/thin/i);
    expect(validateKit(state.kit).ok).toBe(true);
    expect(state.kit.schedule.days).toHaveLength(3);
  });

  it('reports honestly when the description is too short to extract anything', async () => {
    installMockLlm();
    const state = await runPipeline({ jd: 'Engineer wanted.', companyUrl: `${base}/quietco/`, days: 2 });

    expect(state.status).toBe('done');
    expect(state.kit.role.requirements).toEqual([]);
    expect(state.kit.research!.notes.join(' ')).toMatch(/no requirements could be extracted/i);
    expect(state.kit.schedule.days).toHaveLength(2);
  });
});

describe('runPipeline when the model misbehaves', () => {
  it('degrades a failed non-essential step instead of failing the run', async () => {
    // Flashcard generation returns unusable output on every attempt.
    installMockLlm({ failStep: (req) => req.user.includes('"flashcards"') });
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 3 });

    expect(state.status).toBe('done');
    expect(state.kit.flashcards).toEqual([]);
    expect(state.kit.research!.notes.join(' ')).toMatch(/flashcards did not complete/i);
    expect(validateKit(state.kit).ok).toBe(true);
  });

  it('fails the run when requirements cannot be extracted at all', async () => {
    installMockLlm({ failStep: (req) => req.user.includes('Extract the role') });
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 3 });

    expect(state.status).toBe('failed');
    expect(state.error!.code).toBe('EXTRACTION_FAILED');
  });
});

describe('a published design round changes the kit', () => {
  // The brief's claim: "a company that publishes a take-home followed by a system
  // design round should produce a different kit from one that says nothing".
  it('produces system-design questions for a company that documents a design round', async () => {
    installMockLlm();
    const state = await runPipeline({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 4 });

    expect(state.kit.research!.hiring_process_found).toBe(true);
    const designQuestions = state.kit.questions.filter((q) => q.category === 'system-design');
    expect(designQuestions.length).toBeGreaterThan(0);
    expect(
      state.events.some((e) => /design round/i.test(e.message)) ||
        designQuestions.some((q) => q.requirement_ids.length > 0),
    ).toBe(true);
  });

  it('does not invent a design round for a company that documents nothing', async () => {
    installMockLlm();
    const state = await runPipeline({
      jd: 'Support Engineer. Answer customer tickets. Requirements: 2+ years in a support role. Empathy.',
      companyUrl: `${base}/quietco/`,
      days: 2,
    });

    expect(state.kit.research!.hiring_process_found).toBe(false);
    expect(state.kit.questions.filter((q) => q.category === 'system-design')).toEqual([]);
  });
});

describe('single-character and two-character requirements', () => {
  // "Go", "R" and "C" are real requirements. A live run failed an entire case
  // because the schema demanded three characters.
  it('keeps a two-letter skill as a requirement', async () => {
    installMockLlm();
    const state = await runPipeline({
      jd: 'Site Reliability Engineer\n\nRequirements:\n- 4+ years on Kubernetes\n- Deep Linux knowledge\n\nDesirable:\n- Go',
      companyUrl: `${base}/acme/`,
      days: 2,
    });

    expect(state.status).toBe('done');
    const texts = state.kit.role.requirements.map((r) => r.text);
    expect(texts.some((t) => /\bGo\b/.test(t))).toBe(true);
    expect(validateKit(state.kit).ok).toBe(true);
  });
});

describe('resuming generation across slices', () => {
  // How the deployed app runs: /advance does one time-boxed slice, persists, and
  // the client calls again. A real run takes 40-75s against a model, far longer
  // than any serverless invocation, so this path is the one that matters.
  it('completes the same kit over many small slices as it does in one run', async () => {
    installMockLlm();
    let state = createInitialState({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 4 });

    let slices = 0;
    while (state.status === 'running' && slices < 40) {
      // A zero budget forces the loop to hand control back after every step.
      const persisted = JSON.parse(JSON.stringify(state)) as typeof state;
      state = await advance(persisted, { timeBudgetMs: 0 });
      slices++;
    }

    expect(state.status).toBe('done');
    expect(slices).toBeGreaterThan(5); // genuinely sliced, not one pass
    expect(validateKit(state.kit).ok).toBe(true);
    expect(uncoveredMustHaves(state.kit)).toEqual([]);
    expect(state.kit.schedule.days).toHaveLength(4);
  });

  it('survives a round trip through JSON at every step, as the database requires', async () => {
    installMockLlm();
    let state = createInitialState({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 3 });

    while (state.status === 'running') {
      state = await advance(state, { timeBudgetMs: 0 });
      // Everything the pipeline carries has to be storable and restorable.
      const roundTripped = JSON.parse(JSON.stringify(state));
      expect(roundTripped).toEqual(state);
      state = roundTripped;
    }

    expect(state.status).toBe('done');
    expect(validateKit(state.kit).ok).toBe(true);
  });

  it('reports progress that only ever moves forward', async () => {
    installMockLlm();
    let state = createInitialState({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 2 });

    let previous = -1;
    while (state.status === 'running') {
      state = await advance(state, { timeBudgetMs: 0 });
      const percent = progressPercent(state);
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
    expect(progressPercent(state)).toBe(100);
  });
});

describe('research findings survive being stored and resumed', () => {
  // Caught against a real site: the interview stages we had successfully found
  // were stashed as an ad-hoc property, and the repository rebuilds state from
  // declared fields only — so every slice boundary silently threw them away and
  // the questions were written as though no process had been found.
  it('carries the discovered interview stages through a storage round trip', async () => {
    installMockLlm();
    let state = createInitialState({ jd: SENIOR_JD, companyUrl: `${base}/acme/`, days: 3 });

    while (state.status === 'running') {
      state = await advance(state, { timeBudgetMs: 0 });
      // Exactly what the repository does: persist named fields, rebuild from them.
      state = toState({
        id: 'x',
        userId: 'u',
        title: 't',
        fingerprint: 'f',
        input: state.input,
        status: state.status,
        step: state.step,
        completed: state.completed,
        passes: state.passes,
        error: state.error,
        events: state.events,
        artifacts: state.artifacts,
        context: state.context,
        kit: state.kit,
        leaseUntil: null,
        practice: {},
        createdAt: '',
        updatedAt: '',
      });

      if (state.completed.includes('research.hiring') && state.kit.research!.hiring_process_found) {
        expect(state.context.hiringStages.length).toBeGreaterThan(0);
      }
    }

    expect(state.status).toBe('done');
    expect(state.context.hiringStages.length).toBeGreaterThan(0);
  });

  it('defaults the findings for a kit stored before the field existed', () => {
    const restored = toState({
      artifacts: { pages: [] },
      context: undefined,
      status: 'running',
      step: 'extract',
      completed: [],
      passes: 0,
      error: null,
      events: [],
      input: { jd: '', companyUrl: '', days: 1 },
      kit: kitFixture(),
      id: 'x', userId: 'u', title: 't', fingerprint: 'f',
      leaseUntil: null, practice: {}, createdAt: '', updatedAt: '',
    });
    expect(restored.context).toEqual({ hiringStages: [], publicThemes: [] });
  });
});
