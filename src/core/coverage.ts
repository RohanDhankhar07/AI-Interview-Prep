import type { Question, Requirement } from './types';
import { jaccard, keywords } from './text';

/**
 * Coverage is decided here, in code, never by the model.
 *
 * A question's claim to cover a requirement is only accepted if the link is
 * *lexically supported*: the question text must actually share vocabulary with
 * the requirement. Without that check a model can close every gap by asserting
 * `requirement_ids: ["r1","r2","r3"]` on an unrelated question.
 */

export interface CoverageLink {
  requirement_id: string;
  question_ids: string[];
}

export interface CoverageReport {
  /** Requirements with no verified question, must-priority first. */
  uncovered_requirement_ids: string[];
  uncovered_must_ids: string[];
  uncovered_nice_ids: string[];
  links: CoverageLink[];
  /** Links the model asserted that the text does not support. Reported, not trusted. */
  unsupported_links: { question_id: string; requirement_id: string }[];
  /** Questions pointing at requirement ids that do not exist. */
  dangling_links: { question_id: string; requirement_id: string }[];
}

/** Minimum lexical agreement for an asserted link to count. */
const MIN_JACCARD = 0.06;

export function isLinkSupported(req: Requirement, q: Question): boolean {
  const reqWords = keywords(req.text);
  if (reqWords.size === 0) return true; // nothing to match against; accept the assertion
  const qWords = keywords(`${q.prompt} ${q.answer_outline}`);
  let shared = 0;
  for (const w of reqWords) if (qWords.has(w)) shared++;
  // One strong shared term (e.g. "kubernetes") is enough; otherwise fall back to overlap ratio.
  return shared >= 1 || jaccard(reqWords, qWords) >= MIN_JACCARD;
}

export function checkCoverage(
  requirements: Requirement[],
  questions: Question[],
): CoverageReport {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const links = new Map<string, string[]>(requirements.map((r) => [r.id, []]));
  const unsupported: CoverageReport['unsupported_links'] = [];
  const dangling: CoverageReport['dangling_links'] = [];

  for (const q of questions) {
    for (const rid of new Set(q.requirement_ids)) {
      const req = byId.get(rid);
      if (!req) {
        dangling.push({ question_id: q.id, requirement_id: rid });
        continue;
      }
      if (isLinkSupported(req, q)) links.get(rid)!.push(q.id);
      else unsupported.push({ question_id: q.id, requirement_id: rid });
    }
  }

  const uncoveredMust: string[] = [];
  const uncoveredNice: string[] = [];
  for (const r of requirements) {
    if (links.get(r.id)!.length > 0) continue;
    (r.priority === 'must' ? uncoveredMust : uncoveredNice).push(r.id);
  }

  return {
    uncovered_requirement_ids: [...uncoveredMust, ...uncoveredNice],
    uncovered_must_ids: uncoveredMust,
    uncovered_nice_ids: uncoveredNice,
    links: [...links].map(([requirement_id, question_ids]) => ({ requirement_id, question_ids })),
    unsupported_links: unsupported,
    dangling_links: dangling,
  };
}

/**
 * Which category should close a gap for this requirement. Deciding this in code
 * keeps "5 years of React" going to a technical prompt and "mentor juniors"
 * going to a behavioural one, rather than one undifferentiated call.
 */
export function categoryForRequirement(req: Requirement): Question['category'] {
  if (req.kind === 'behavioural') return 'behavioural';
  if (req.kind === 'domain') return 'company-fit';
  return /architect|scal|distributed|system design|infrastructur|throughput|latency|availability|micro-?service/i.test(
    req.text,
  )
    ? 'system-design'
    : 'technical';
}
