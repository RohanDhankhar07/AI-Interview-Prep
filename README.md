# The AI Interview Prep Kit

Paste a job description, give the company's website address and say how many days you have.
The application researches the company itself — crawling the site for what they do and how they
hire, and searching for public discussion of their interview process — and turns all of it into a
structured prep kit: a company brief, a role breakdown, a question bank tied to the actual
requirements, flashcards, and a day-by-day schedule. Everything is editable, regenerable
section-by-section, and practisable inside the app.

---

## Contents

- [Tech stack](#tech-stack)
- [Setup](#setup)
- [The batch entry point](#the-batch-entry-point)
- [Architecture](#architecture)
- [Retrieval](#retrieval-what-we-fetch-and-how)
- [Research and generation sequence](#research-and-generation-sequence)
- [The coverage loop](#the-coverage-loop-second-pass)
- [Generated, edited and pinned state](#generated-edited-and-pinned-state)
- [Schedule allocation](#schedule-allocation)
- [Practice mode and the creative feature](#practice-mode-and-the-creative-feature)
- [Long-running generation](#long-running-generation)
- [Edge cases](#edge-cases)
- [Security](#security)
- [Tests](#tests)
- [Deployment](#deployment)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Known limitations](#known-limitations)

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router) + Tailwind CSS v4 | As preferred by the brief. |
| Backend | Next.js Route Handlers on the Node runtime | See below. |
| Database | MongoDB (Atlas free tier) | As preferred by the brief. |
| Language | TypeScript, strict | |
| Scraping | `fetch` + `cheerio` | No headless browser: it would not fit a free serverless tier, and the pages worth reading are server-rendered HTML. |
| LLM | Groq (`openai/gpt-oss-120b`) by default | Genuine free tier, fast, JSON mode. Gemini, OpenRouter, Cerebras and any OpenAI-compatible endpoint are also supported — one env var. |
| Search | Serper / Brave / Tavily if a key is present, DuckDuckGo otherwise | Works with no credentials at all, better with them. |

**The one deviation: Route Handlers instead of a separate Express server.** The brief asks for
Node + Express; this is Node, and the routing layer is the only difference. Two reasons for the
choice. First, the deployment target is Vercel, where a single Next.js application deploys as one
unit — a separate Express service would need a second host, a second deployment and CORS between
them, for no functional gain. Second, and more importantly, it costs nothing architecturally: the
route handlers in `src/app/api/**` are thin. They authenticate, validate, call a service, and
serialise. Every piece of real logic lives in `src/core` (framework-free) and `src/server`
(persistence and application services), neither of which imports anything from Next. Swapping
Express in would mean rewriting the twelve files under `src/app/api`, and nothing else.

---

## Setup

Requires Node 20+.

```bash
git clone <this repo> && cd interview-prep-kit
npm install
cp .env.example .env.local     # then fill in AUTH_SECRET and one LLM key
npm run dev                    # http://localhost:3000
```

`.env.example` documents every variable. The two that matter to get started:

- `AUTH_SECRET` — any random 32+ character string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- `GROQ_API_KEY` — free key from [console.groq.com](https://console.groq.com). Or set
  `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`, etc.

Providers retire models often — Groq has already dropped Llama 3.3 70B. If a run fails with
`model_not_found`, list what your key can use and set `LLM_MODEL` accordingly; no code change
is needed:

```bash
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.map(m=>m.id).join('\n')"
```

Once `MONGODB_URI` is set, check it before running the app:

```bash
npm run db:check
```

It separates the failures Atlas otherwise reports as one opaque timeout — DNS, TCP, the TLS
handshake (which is where a missing IP-access-list entry shows up), authentication, and a
real write — and creates the indexes the app depends on. **Atlas requires your IP on the
access list** (Network Access › Add IP Address): your own IP for local work, and `0.0.0.0/0`
for Vercel, whose egress IPs are not fixed on the free tier.

`MONGODB_URI` is optional in development — with no URI the app uses an in-memory store so you can
run it immediately. It is **required** in production; the app refuses to start without it rather
than silently losing data on a cold start.

### Running with no credentials at all

`LLM_PROVIDER=mock` selects a deterministic offline model (`src/core/llm/offline.ts`). It produces
structurally real kits — every field populated, coverage genuinely checked, schedule genuinely
allocated — with derived rather than reasoned content. It exists so the pipeline, the tests and a
first-run smoke test work with no key and no network:

```bash
npm run mocksite                                     # local company sites on :8099
LLM_PROVIDER=mock SEARCH_DISABLED=true npm run dev
```

`npm run mocksite` serves two fixture sites used throughout: `/acme/`, which documents its hiring
process at `/acme/handbook/how-we-hire` — reachable only through a *relative* footer link, so a
hard-coded path list misses it — and `/quietco/`, a real-looking site with no hiring page anywhere.

### Troubleshooting

**API routes returning 404 locally.** `next build` and `next dev` share `.next`, and a
production build left on top of a dev server makes nested route segments
(`/api/kits/[id]/advance`) stop resolving while `/api/kits/[id]` still answers. Delete the
directory and restart:

```bash
rm -rf .next && npm run dev
```

**`model_not_found` from the provider.** Providers retire models; see the model-listing
command above and set `LLM_MODEL`.

**Atlas connection problems.** `npm run db:check` names the failing stage.

---

## The batch entry point

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Reads `[{ id, jd, company_url, days }]` and writes the Appendix B envelope. It runs the same
`src/core/pipeline` the web app runs — there is no parallel implementation — and continues past a
failing case, recording the failure.

```bash
npm run mocksite &                                             # in another shell
npm run evaluate -- --input fixtures/cases.example.json --output kits.json
```

`fixtures/cases.example.json` covers the three interesting shapes: a full posting against a company
that documents its process, a two-line stub against a company that documents nothing, and a
company URL that does not resolve.

- **Concurrency** defaults to 2 cases at a time (`--concurrency N`, max 4). Model calls are
  additionally serialised by a shared limiter, so raising it does not multiply the request rate
  into a free-tier ceiling. Five cases complete in about three minutes on Groq's free tier.
- **`ALLOW_PRIVATE_NETWORK` is forced on** by this command, because the brief states company sites
  may be served from a local address. The web application does the opposite in production.
- **Exit code is 0** even when cases fail: a failed case is a recorded outcome in the output file,
  not a failed run.
- **`ok` vs `failed`:** `failed` is reserved for a case that produced no kit at all — the job
  description could not be read, or the model provider was unavailable for every question category.
  An unreachable company site is **not** a failure: the kit is still built from the posting, the
  brief says plainly that nothing could be retrieved, and `research.skipped_sources` records why.

---

## Architecture

```
src/
  core/                 framework-free; imports nothing from Next or Mongo
    types.ts            Appendix A as zod schemas + inferred types
    pipeline.ts         the step machine that sequences everything
    coverage.ts         DETERMINISTIC — which requirements have a question
    schedule.ts         DETERMINISTIC — allocation across the days available
    merge.ts            regeneration rules (what a regeneration may replace)
    mutations.ts        every builder edit, as a validated operation
    practice.ts         spaced repetition + the weak-spots roll-up
    validate.ts         structure + referential integrity
    net/                ssrf · fetcher · robots · ratelimit · extract · search
    llm/                provider ladder · JSON repair · prompt safety · offline model
    steps/              one file per pipeline step
  server/               persistence and application services
    auth.ts  db.ts  http.ts  kitService.ts  repo/{mongo,memory}.ts
  app/                  Next.js: pages and thin route handlers
  components/           UI
scripts/evaluate.ts     the batch entry point
fixtures/mock-site.ts   local company sites (shared by tests and `npm run mocksite`)
tests/                  104 tests, all offline
```

The rule that keeps this honest: **`src/core` never imports from `src/server` or `src/app`.** That
is what lets the batch runner and the web app share one pipeline, and what lets the whole thing be
tested without a server, a database or a network.

---

## Retrieval: what we fetch and how

Everything that touches the open internet goes through `src/core/net/fetcher.ts`. One door.

**Sources used:**

1. **The pasted job description.** No retrieval — it is already text.
2. **The company's own site.** Crawled from the URL the user gives.
3. **`/sitemap.xml`**, when it exists — the cheapest way to discover a `/handbook/hiring` that
   nothing links to.
4. **Public web search** for candidate-reported interview experience.
5. **Applicant tracking systems** (Greenhouse, Lever, Ashby, Workable, SmartRecruiters) when the
   company links to one. Off-domain, but exactly where hiring detail often lives.

**Finding the hiring page.** The path cannot be hard-coded, so the crawler scores every discovered
link and spends a small budget on the best ones (`scoreLink` in `steps/crawlCompany.ts`, a pure
function with its own tests). The score combines:

- path tokens — `how-we-hire` and `interview-process` score far above `careers`, which scores above
  `about`, which scores above `blog`;
- anchor text, at 70% weight, because "How we hire" in a footer is as strong a signal as the path;
- penalties for assets, login pages, legal pages, tag archives and long query strings;
- a depth penalty and a path-length penalty, so shallow beats deep.

Links to other domains score `-Infinity` unless they are on a known ATS host. Subdomains of the
same registrable domain count as the same site; on a local or IP host, one origin is one site, so
batch fixtures on `localhost:8099` crawl correctly and relative links resolve.

A fixed list of conventional paths (`/careers`, `/jobs`, `/about`, …) exists but is **only** a
fallback for a homepage that links nowhere useful. It is never the primary mechanism.

**Politeness and robustness.** `robots.txt` is fetched once per origin, parsed properly
(longest-match rules, wildcards, `$` anchors, agent-specific groups beating `*`) and respected,
including its `Crawl-delay`. Requests are queued per host with a minimum interval and a small
concurrency cap. Transient failures — network, timeout, 429, 5xx — retry with exponential backoff
and full jitter, honouring `Retry-After`. A page we cannot retrieve is recorded in
`research.skipped_sources` with its reason and the crawl carries on; it is never fatal.

---

## Research and generation sequence

Each step is a separate function with its own prompt and its own failure policy. `pipeline.ts`
sequences them; the sequence responds to what was actually found.

| # | Step | Retrieval | Model | Fatal? |
| --- | --- | --- | --- | --- |
| 1 | `extract` — requirements, priorities, role | none (pasted text) | ✅ | **yes** — no requirements, no kit |
| 2 | `research.crawl` — crawl and rank the company site | ✅ | ❌ | no |
| 3 | `research.brief` — write the brief from retrieved pages | — | ✅ | no |
| 4 | `research.hiring` — is a hiring process published, and what is it? | — | ✅ | no |
| 5 | `research.discussion` — search and read public discussion | ✅ | ✅ | no |
| 6–9 | `questions.{technical,behavioural,system-design,company-fit}` | — | ✅ ×4 | only if *all* fail |
| 10 | `coverage` — which requirements have no question | — | ❌ **code** | no |
| 11 | `coverage.gaps` — write the missing questions, then re-check | — | ✅ | no |
| 12 | `flashcards` | — | ✅ | no |
| 13 | `schedule` — allocate across the days available | — | ❌ **code** | no |
| 14 | `finalise` — validate the whole kit | — | ❌ **code** | **yes** |

**The sequencing is real, not decorative.**

- Step 4 changes step 6–9. When a company publishes "take-home, then a system design round", those
  stages are in the question prompts and the questions are shaped for them. When it publishes
  nothing, the prompt says so explicitly and forbids assuming a format.
- Steps 6–9 are four separate calls with four genuinely different sets of instructions
  (`CATEGORY_BRIEFS` in `steps/generateQuestions.ts`). "5+ years of React" is routed to the
  technical prompt, which asks for hands-on depth and failure modes; "mentor junior engineers" is
  routed to the behavioural prompt, which asks for a "tell me about a time" and coaches the
  candidate on structuring a real story. They could not come from the same call.
- Routing is deterministic (`categoryForRequirement`): `kind` decides first, then architecture
  vocabulary in the requirement text promotes technical → system-design.

**Two things the model is never allowed to decide**, as the brief requires:

1. **Coverage** (`core/coverage.ts`) — pure code.
2. **Schedule allocation** (`core/schedule.ts`) — pure arithmetic.

Ids are also minted in code, never by the model, so `r1..rn` and `q1..qn` are dense and stable and
a regeneration cannot renumber anything.

---

## The coverage loop (second pass)

After the first draft, `checkCoverage` compares questions against requirements. A question's claim
to cover a requirement is only accepted if the link is **lexically supported** — the question text
must actually share vocabulary with the requirement. Without that check a model closes every gap by
writing `requirement_ids: ["r1","r2","r3"]` on an unrelated question, and coverage becomes a
statement of intent rather than a fact. Unsupported claims are reported and not counted.

Requirements with no supported question come back as gaps. The gap pass groups them by category,
generates **one question per requirement** with the requirement text quoted (so the resulting
question shares its vocabulary and the link verifies), and the loop re-checks.

**When it stops.** Whichever comes first:

- no requirements remain uncovered;
- **three passes** have run; or
- a pass closed nothing — if quoting the requirement text produced no usable question, a fourth
  identical attempt will not either, and the loop stops rather than burning tokens.

Three is a judgement, not a law. Pass 1 covers the ordinary case. Pass 2 catches the requirement
the category prompts skipped. By pass 3 the failures left are ones the model genuinely cannot
handle — usually a requirement that is not really a requirement ("a sense of humour"). Anything
still uncovered is reported honestly in `coverage.uncovered_requirement_ids` and shown at the top
of the builder in red, rather than papered over.

---

## Generated, edited and pinned state

The hardest state problem in the assessment, and the answer is deliberately small. **Every
question, flashcard and requirement, and the brief, carries two extra fields:**

```ts
origin: 'generated' | 'edited' | 'manual'
pinned: boolean
```

- `generated` — written by the model, untouched by the user. **Replaceable.**
- `edited` — generated, then changed by the user. **Preserved.**
- `manual` — written by the user. **Preserved**, and pinned on creation.
- `pinned` — an explicit user override that preserves an item whatever its origin.

Any edit through `core/mutations.ts` flips `origin` to `edited`. That includes moving a question to
a different category: the user made a decision, and the next regeneration of *either* category must
not undo it.

Regeneration (`core/merge.ts`) is scoped to one section. Within it, protected items keep their ids
and their positions, unprotected generated items are dropped, and the new draft is inserted
**after** the survivors. New ids are minted against every id in the whole kit, so schedule
references stay valid. Anything outside the section is not touched at all — regenerating the
technical questions cannot disturb a behavioural question, a flashcard, the brief or the schedule.

A pinned **brief** is never overwritten, even by an explicit regeneration of the brief; the UI
disables the button and says why. That is the one place where pinning outranks a direct instruction,
because "regenerate" there is one click away from destroying something you wrote.

Provenance is visible in the UI on every item ("Generated" / "Edited" / "Yours" / "Pinned"), so
before clicking Regenerate you can see exactly what would be replaced.

Coverage and schedule integrity are **recomputed after every edit** — they are derived facts, never
something the client sends. Deleting a question prunes it from the schedule; deleting a requirement
unlinks it everywhere. The result is validated before it is saved, so a client cannot write a kit
that would fail validation.

---

## Schedule allocation

Pure arithmetic in `core/schedule.ts`, with tests for each guarantee.

1. **Budget.** Each question costs minutes by difficulty: `1 → 8`, `2 → 12`, `3 → 18`. Integers
   throughout.
2. **Rank.** Must-have first, then (if there is practice feedback) weakest first, then hardest,
   then by category weight, then by id — a total order, so allocation is deterministic.
3. **Fill.** Capacity tapers from 1.25× the daily mean on day 1 to 0.75× on the last learning day,
   so heavy must-have material lands early rather than the night before. A day is never left empty:
   when the questions remaining exactly equal the days remaining, the allocator advances regardless
   of capacity.
4. **Surplus days become spaced review.** With 20 questions and 60 days, days 21–60 cycle back
   through the hardest and highest-priority material at half cost rather than sitting empty.
5. **One day** puts everything in day 1. That is what the user asked for.

Guarantees, each with a test: `days.length === days_available` exactly; every question is scheduled
at least once (so every covered requirement, including every must-have, appears); harder and
must-have material lands earlier; every `minutes` is an integer; every `question_ids` entry refers
to a question that exists.

Day focus lines ("Technical: kubernetes, postgresql") are derived from the day's own material in
code. No model call.

---

## Practice mode and the creative feature

**Practice** steps through flashcards one at a time — space reveals, `1`/`2`/`3` rate — and saves
each rating as it happens, so an abandoned session still counts. Progress ("14 of 22 covered, 3
shaky") is always visible.

**Ordering.** Unseen and least-confident first, then by due date. The interval is a compressed
spaced-repetition ladder: shaky → back in 10 minutes and the streak resets; nearly → 1–3 days;
confident → 2^reps days, capped at 21. Full SM-2 tunes an ease factor per card from a five-point
grade; with three buttons and a study window measured in days, that machinery cannot pay for
itself. The order is fixed when a session starts, so the queue does not rearrange itself under the
user's hands.

### The creative feature: weak spots, fed back into the schedule

Practice happens on **cards**. An interviewer probes **requirements**. The schedule allocates
**questions**. All three meet at the requirement id, and nothing in the app was using that.

After a session, the **weak spots report** rolls card confidence up to the requirement level and
ranks it — unpractised must-haves first, then lowest confidence. It answers the question a candidate
actually has the night before: *not* "which cards did I fail" but **"which of the things they will
definitely ask am I weakest on?"**

Then one button: **Re-plan my schedule around these.** It re-runs the same deterministic allocator
that built the original plan, with confidence per question derived from the cards that share its
requirements — so material you found hard is pulled earlier within its priority band. Must-haves
still come first; practice only reorders within that. The plan is not a static artefact you read
once; it responds to how preparation is actually going, and it does so without a single extra token.

---

## Long-running generation

Generation takes 60–120 seconds and every serverless platform will kill a request long before that.
So the pipeline is a **resumable state machine**, not one long function.

`advance(state, { timeBudgetMs })` runs steps until its budget is spent and returns state that is
safe to persist. `POST /api/kits/:id/advance` runs one ~25s slice and returns the step, the
progress and the recent events; the client calls it again until the kit is done. The same
`advance` drives the batch runner, which just does not stop.

This falls out well:

- **Real progress.** The bar reflects the step the pipeline is actually on, weighted by wall-clock
  cost, not a fake timer.
- **Closing the tab is safe.** Every slice is persisted. Reopening the kit resumes from the step it
  stopped at.
- **Triggered twice is safe.** Advancing takes a **lease** (`findOneAndUpdate` on an expired-or-null
  `leaseUntil`). A second tab gets a `409` and waits rather than running the pipeline twice.
- **Failing halfway is cheap.** State is kept, so "Retry from where it stopped" continues from the
  failed step instead of re-crawling and re-extracting. A rate-limit failure costs one step, not a
  whole run.
- **The same posting twice** is a content fingerprint (`sha256` of normalised JD + company URL) with
  a unique index on `(userId, fingerprint)`. Submitting again returns the existing kit and says so;
  a race on two identical submissions is caught by the duplicate-key error and resolves to the same
  kit.

---

## Edge cases

| Case | Behaviour |
| --- | --- |
| Company URL invalid, 404, or times out | Recorded in `skipped_sources` with the reason. The kit is built from the posting; the brief says plainly that nothing could be retrieved. **Not** a failure. |
| No hiring or about page anywhere | `hiring_process_found: false`, plus a note that no interview format has been assumed. The question prompts are explicitly told not to invent one. |
| Two-line job description | Under 40 characters, no model call at all — an empty kit that says so. Otherwise a thin kit with a note giving the character count and requirement count. The extraction prompt's first rule is that three honest requirements beat ten invented ones. |
| No public discussion found | `public_discussion_found: false` and a note. A normal outcome, never an error. |
| Model returns invalid JSON | Local repair first (code fences, prose, trailing commas, smart quotes, balanced-brace extraction), then the model is handed its own output and the validation errors to correct — up to 3 attempts. Then the step fails on its own terms. |
| Model returns an incomplete kit | Every step validates against a zod schema before its output is used; the whole kit is validated before it is saved or written to the batch output. |
| Rate limited / provider blips | Retry with backoff and jitter, honouring `Retry-After` (including Groq's "try again in 6.7s" body text). Calls are queued globally to stay under tokens-per-minute. |
| Same description and company twice | Fingerprint dedupe; returns the existing kit. |
| 1-day or 60-day schedule | 1 day takes everything; 60 days with 20 questions gives ~13 learning days and 47 spaced-review days. Requests are clamped to 1–90. |

The consistent principle: **a thin kit that says it is thin beats a padded one.** Every degradation
is recorded in `research.notes` and surfaced in the UI, not hidden.

---

## Security

- **SSRF.** Every URL — the one the user types, every link the crawler follows, every search result,
  and **every redirect hop** — is validated. Only http/https, no embedded credentials. Hostnames are
  DNS-resolved and rejected if any record is loopback, private, link-local (including
  `169.254.169.254`), CGNAT, multicast, or an IPv4-mapped IPv6 form of any of those. Private
  addresses are refused in production and allowed only when `ALLOW_PRIVATE_NETWORK` is set, which
  the batch runner does for local company fixtures.
- **Content constraints.** Only `text/html`, `application/xhtml+xml` and `text/plain` are accepted.
  Bodies are streamed and aborted the moment they exceed 2 MB, so an endless response cannot exhaust
  memory. Every request has a timeout; redirects are capped at 4.
- **Prompt injection.** Both the pasted description and every crawled page are text we did not
  write, and all of it reaches a model. Each untrusted block is wrapped in a **per-call random
  delimiter** (`UNTRUSTED_<random hex>`), labelled as data, and the system prompt states that text
  inside a data block is content to analyse and never instructions to follow. Before it goes in, the
  content is neutralised: anything imitating our own markers, chat-template control tokens
  (`[INST]`, `<|im_start|>`), and line-leading `System:` / `Assistant:` preambles are redacted. The
  content cannot close its own fence.
- **Authorisation.** Sessions are a signed JWT in an httpOnly, SameSite=Lax, Secure-in-production
  cookie; passwords are bcrypt at cost 12. Middleware turns away requests with no cookie, but that
  is a redirect, not the authorisation: **every query is scoped by user id in the repository**, so a
  valid session for user A cannot read or write user B's kit under any code path.
- **Input validation.** Every request body is parsed by a zod schema and capped at 200 KB. Every
  builder edit is a typed operation, not a client-supplied kit — the client can never write kit
  state directly, only ask for a transformation the server applies and validates.

---

## Tests

```bash
npm test          # 117 tests, no network, no database, no API key
npm run typecheck
```

Focused on what is worth protecting and hard to eyeball:

- **`schedule.test.ts`** — every guarantee above: exact day count for 1/2/3/5/14/60 days, nothing
  dropped, must-haves present, front-loading, integer minutes, surplus days as review.
- **`coverage.test.ts`** — gaps found, unsupported links refused, dangling references reported,
  category routing.
- **`validate.test.ts`** — structure, referential integrity, and an **Appendix A contract test**
  that asserts the exact field names, so a refactor cannot silently drift from the brief.
- **`merge.test.ts`** — the regeneration rules, item by item: edited kept, manual kept, pinned kept,
  other categories untouched, ids never colliding, ordering preserved.
- **`mutations.test.ts`** — every builder edit, and that the kit is still valid after each one.
- **`pipeline.test.ts`** — end to end against a local company site and a deterministic model:
  finds the hiring page behind a relative link, closes a coverage gap on a second pass, degrades
  honestly on an unreachable site, produces a thin kit for a thin posting, survives a step that
  returns garbage, and fails properly when extraction is impossible.
- **`crawl.test.ts`** — link ranking, HTML extraction, relative-link resolution, robots.txt.
- **`security.test.ts`** — SSRF ranges, injection neutralisation, JSON repair.
- **`practice.test.ts`** — intervals, session ordering, the weak-spots roll-up.
- **`provider.test.ts`** — the real HTTP path against a local stand-in for an OpenAI-compatible
  provider and for Gemini: request shape, a 429 waited out via `Retry-After`, a rate-limit delay
  read out of the response body, a 400 not retried, and the JSON-repair loop over the wire.
  Without this the only exercised provider would be the in-process mock.

---

## Deployment

Deployed on Vercel with MongoDB Atlas. Frontend and backend are the same deployment; the API
is reachable under `/api/*`.

### 1. MongoDB Atlas

Create a free M0 cluster, then **Network Access → Add IP Address → `0.0.0.0/0`**. Vercel's
egress IPs are not fixed on the free tier, so an allow-list of specific addresses will not
work. Verify the connection string before deploying:

```bash
npm run db:check
```

### 2. Import into Vercel

The defaults are correct — Next.js is detected, no build configuration needed.
`vercel.ts` in the repository root carries the project configuration:

- **`regions: ['bom1']`** — functions run in Mumbai. This is deliberate: the Atlas cluster
  is in `ap-south-1`, and one request makes several round trips to it (read the kit, take the
  generation lease, write the result). Left on the default `iad1`, every one of those crosses
  an ocean. **If you move the cluster, change this** — functions belong beside the database,
  because database round trips outnumber everything else.
- **Security headers** — `nosniff`, `DENY` framing, a strict referrer policy, HSTS, and
  `Cache-Control: no-store` on `/api/*` so no proxy or CDN ever stores a response that belongs
  to one signed-in user.

`vercel.ts` is the current configuration format and replaces `vercel.json`. If your project
does not pick it up, the same two settings are available in the dashboard under Settings →
Functions (region) — the deployment works either way, just with a slower database path.

### 3. Environment variables

Set these for Production and Preview:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs session JWTs. 32+ random characters. |
| `MONGODB_URI` | Atlas connection string. **Required** — the app refuses to start without it in production rather than silently using an in-memory store. |
| `MONGODB_DB` | Database name. Defaults to `interview_prep_kit`. |
| `LLM_PROVIDER` | `groq` (default), `gemini`, `openrouter`, `cerebras`. |
| `GROQ_API_KEY` | …or the matching key for your provider. |
| `LLM_MODEL` | Optional. Set when the provider retires the default model. |
| `CRAWLER_USER_AGENT` | Identifies the crawler to the sites it visits. Put a contact URL in it. |
| `SERPER_API_KEY` | Optional. Better public-discussion search than the keyless fallback. |
| `ALLOW_PRIVATE_NETWORK` | **Leave unset.** Defaults to false in production, which is what refuses to fetch private and loopback addresses. |

Secrets are read server-side only; no `NEXT_PUBLIC_*` variable carries one.

### 4. Verify

`GET /api/health` reports which pieces are configured — database, auth secret, model
provider, search — without revealing any value. It is the quickest way to confirm the
variables landed.

### Function durations

Generation runs in time-boxed slices, and two different limits are involved:

- `ADVANCE_BUDGET_MS` (25s) decides when a slice stops *starting* new steps and returns a
  progress update. It is a UX choice — it keeps a two-minute generation reporting in several
  times instead of going quiet.
- `maxDuration` (300s, the platform default on every plan under Fluid Compute) is a safety
  ceiling. A step already in flight when the budget runs out is allowed to finish, and a
  single model call with rate-limit backoff can take well over a minute on a free tier.

These are deliberately far apart. Setting `maxDuration` near the budget kills steps mid-flight
and throws away their work.

## Design decisions and trade-offs

**Coverage requires lexical support, not just an assertion.** The alternative — trusting
`requirement_ids` — makes coverage unfalsifiable. The cost is a false negative when a question
covers a requirement in entirely different words; the gap pass then writes a redundant question.
A redundant question is a much cheaper mistake than a coverage report that means nothing.

**The pipeline is a state machine, not a function.** More code than `await step1(); await step2()`,
and worth it: it is the same mechanism for progress reporting, resumability, serverless time limits,
double-submit safety and cheap retries. One design answers five requirements.

**Page text is dropped after the research steps.** The brief and hiring-process steps consume it
immediately, then `artifacts.pages` is cleared, so kit documents stay small. The cost: regenerating
the brief has to re-crawl. That is the honest behaviour anyway — a brief regenerated from stale
cached text is not really regenerated.

**Two repository implementations.** In-memory for development so the app runs with zero setup,
Mongo for real use. `getRepositories()` refuses to select in-memory in production, so a missing
`MONGODB_URI` fails loudly at start rather than quietly losing every kit on the next cold start.

**Optimistic UI with a real rollback.** Edits apply locally and immediately; a rejected save puts
the previous state back and says why. A sequence number stops a slow response from overwriting a
newer local edit. Text fields debounce at 900 ms and commit on blur, and an incoming server value
only replaces yours while the field is not focused — so typing is never interrupted by a round trip.

**Search degrades rather than requiring a key.** A proper search API is used when configured; with
no key, DuckDuckGo's keyless endpoint is parsed defensively and any change in its markup degrades to
"no results found", which the kit then reports honestly. Aggregators that reliably block automated
reads (Glassdoor, LinkedIn, Indeed) are not fetched at all — where their search snippet is all we
have, only the snippet is used, and that is recorded.

**No headless browser.** A client-rendered careers page is invisible to us. Playwright would not fit
a free serverless tier, and the pages that actually describe hiring processes — handbooks,
engineering blogs, careers pages — are overwhelmingly server-rendered. The trade is stated rather
than hidden: `research.crawled_pages` and `skipped_sources` show exactly what was read.

---

## Known limitations

- **JavaScript-rendered sites** are read as whatever their HTML contains, which for some SPAs is
  nearly nothing. The kit reports thin research rather than pretending.
- **Search without an API key is best-effort.** DuckDuckGo may return nothing under load; the kit
  says so instead of failing.
- **The offline model (`LLM_PROVIDER=mock`) is for smoke tests only.** Structurally real, not
  genuinely reasoned. It is never a silent fallback for a missing key — you have to ask for it.
- **Coverage is checked at the requirement level, not for depth.** One question against a
  requirement satisfies it; whether one question is *enough* for "5+ years of React" is a judgement
  the app leaves to the user, who can add their own.
- **Practice state is per kit**, not across kits. Preparing for two React roles means practising
  React twice.
- **No streaming.** Progress is polled per step rather than streamed token by token. Steps, not
  tokens, are the useful unit here, and polling survives a dropped connection.
- **The in-memory development store is per process.** Restarting `npm run dev` clears it. Set
  `MONGODB_URI` locally to keep kits between restarts.
