import { MockProvider, type CompletionRequest, type LlmProvider } from './provider';

/**
 * A deterministic, credential-free stand-in for the model.
 *
 * Selected with LLM_PROVIDER=mock, it lets the batch runner, the tests and a
 * first-run smoke test exercise the whole pipeline offline. It answers each step
 * from cues in the prompt, and can be told to leave a requirement uncovered on
 * the first pass or to return unusable output, which is how the coverage loop
 * and the degradation paths are tested.
 *
 * It is never the default: a kit built this way is structurally real but its
 * content is derived, not reasoned.
 */

export interface OfflineOptions {
  /** Requirement ids to ignore on the first question pass, forcing a gap pass. */
  dropOnFirstPass?: string[];
  /** Make the model emit unusable output for a step, to test degradation. */
  failStep?: (req: CompletionRequest) => boolean;
}

const SKILLS = [
  'React', 'TypeScript', 'Go', 'PostgreSQL', 'Kafka', 'Kubernetes',
  'Terraform', 'Node', 'Stripe', 'Python',
];

export function createOfflineProvider(
  options: OfflineOptions = {},
  calls: string[] = [],
): LlmProvider {
  return new MockProvider((req) => {
    const label = labelFor(req);
    calls.push(label);
    if (options.failStep?.(req)) return 'not json at all';

    switch (label) {
      case 'extract':
        return JSON.stringify(extract(req.user));
      case 'brief':
        return JSON.stringify({
          company_name: /acme/i.test(req.user) ? 'Acme Robotics' : 'QuietCo',
          summary: 'A company described by the retrieved pages.',
          what_they_do: 'Builds and sells software to business customers, per the pages retrieved.',
          confident: true,
        });
      case 'hiring':
        return JSON.stringify({
          describes_hiring_process: /take-home|intro call|deep dive/i.test(req.user),
          summary: 'Intro call, take-home exercise, technical deep dive, values interview.',
          stages: [
            { name: 'Take-home exercise', description: 'A small service, three hours, paid.' },
            { name: 'Technical deep dive', description: 'Walkthrough plus system design.' },
          ],
        });
      case 'discussion':
        return JSON.stringify({ has_relevant_discussion: false, summary: '', themes: [] });
      case 'questions': {
        const requirements = parseRequirements(req.user);
        const isGapPass = req.user.includes('currently have no question against them');
        const drop = isGapPass ? [] : (options.dropOnFirstPass ?? []);
        return JSON.stringify({
          questions: requirements
            .filter((r) => !drop.includes(r.id))
            .map((r) => ({
              requirement_ids: [r.id],
              prompt: `Tell me about your experience with ${r.text}.`,
              answer_outline: `A strong answer covers ${r.text} in concrete detail.`,
              difficulty: 2,
            })),
        });
      }
      case 'flashcards': {
        const requirements = parseRequirements(req.user);
        return JSON.stringify({
          flashcards: requirements.map((r) => ({
            front: `What should you be able to say about ${r.text}?`,
            back: `One concrete example involving ${r.text}.`,
            requirement_ids: [r.id],
          })),
        });
      }
      default:
        return '{}';
    }
  });
}

function labelFor(req: CompletionRequest): string {
  if (req.user.includes('Extract the role and its requirements')) return 'extract';
  if (req.user.includes('describes_hiring_process')) return 'hiring';
  if (req.user.includes('has_relevant_discussion')) return 'discussion';
  if (req.user.includes('"company_name"')) return 'brief';
  if (req.user.includes('"flashcards"')) return 'flashcards';
  if (req.user.includes('"questions"')) return 'questions';
  return 'unknown';
}

/** Reads "- r1 [must/technical] text" lines back out of the prompt. */
function parseRequirements(user: string): { id: string; text: string }[] {
  return [...user.matchAll(/^- (r\d+) \[[^\]]+\] (.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
}

function extract(user: string): unknown {
  const jd = user;
  const niceSection = /(nice to have|desirable|bonus)[\s\S]*$/i.exec(jd)?.[0] ?? '';
  const requirements = SKILLS.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(jd)).map((s) => ({
    text: `Experience with ${s}`,
    kind: 'technical',
    priority: new RegExp(`\\b${s}\\b`, 'i').test(niceSection) ? 'nice' : 'must',
    evidence: s,
  }));
  if (/mentor/i.test(jd)) {
    requirements.push({
      text: 'Mentoring mid-level engineers',
      kind: 'behavioural',
      priority: 'must',
      evidence: 'Mentor two or three mid-level engineers',
    });
  }
  if (/on-call|incident/i.test(jd)) {
    requirements.push({
      text: 'On-call ownership and incident review',
      kind: 'behavioural',
      priority: 'must',
      evidence: 'on-call',
    });
  }
  return {
    company_name: /acme/i.test(jd) ? 'Acme Robotics' : '',
    title: /senior backend/i.test(jd) ? 'Senior Backend Engineer' : 'Full Stack Developer',
    seniority: /senior/i.test(jd) ? 'senior' : '',
    location: '',
    responsibilities: ['Build and operate services'],
    requirements,
    thin: requirements.length <= 2,
  };
}
