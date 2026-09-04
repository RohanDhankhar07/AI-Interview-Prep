import { describe, expect, it } from 'vitest';
import { checkCoverage, categoryForRequirement, isLinkSupported } from '../src/core/coverage';
import { normalisePriority, normaliseKind } from '../src/core/steps/extractRequirements';
import { question, req } from './helpers';

describe('checkCoverage', () => {
  const requirements = [
    req('r1', '5+ years with React and TypeScript', 'must'),
    req('r2', 'Experience mentoring junior engineers', 'must', 'behavioural'),
    req('r3', 'Exposure to Terraform', 'nice'),
  ];

  it('reports a requirement with no question as uncovered', () => {
    const report = checkCoverage(requirements, [
      question('q1', ['r1'], { prompt: 'How do you optimise React rendering in TypeScript?' }),
    ]);
    expect(report.uncovered_must_ids).toEqual(['r2']);
    expect(report.uncovered_nice_ids).toEqual(['r3']);
    expect(report.uncovered_requirement_ids).toEqual(['r2', 'r3']);
  });

  it('reports nothing uncovered when every requirement has a supported question', () => {
    const report = checkCoverage(requirements, [
      question('q1', ['r1'], { prompt: 'Describe a hard React performance bug you fixed.' }),
      question('q2', ['r2'], { prompt: 'Tell me about mentoring a junior engineer.' }),
      question('q3', ['r3'], { prompt: 'How have you used Terraform to manage infrastructure?' }),
    ]);
    expect(report.uncovered_requirement_ids).toEqual([]);
  });

  it('refuses a link the question text does not support', () => {
    // The model claims this covers everything; the words say otherwise.
    const report = checkCoverage(requirements, [
      question('q1', ['r1', 'r2', 'r3'], {
        prompt: 'What is your favourite colour?',
        answer_outline: 'Any answer is fine.',
      }),
    ]);
    expect(report.uncovered_requirement_ids).toEqual(['r1', 'r2', 'r3']);
    expect(report.unsupported_links).toHaveLength(3);
  });

  it('records references to requirements that do not exist', () => {
    const report = checkCoverage(requirements, [question('q1', ['r99'], { prompt: 'React' })]);
    expect(report.dangling_links).toEqual([{ question_id: 'q1', requirement_id: 'r99' }]);
  });

  it('lists which questions cover each requirement', () => {
    const report = checkCoverage(requirements, [
      question('q1', ['r1'], { prompt: 'React rendering' }),
      question('q2', ['r1'], { prompt: 'TypeScript generics in React' }),
    ]);
    expect(report.links.find((l) => l.requirement_id === 'r1')!.question_ids).toEqual(['q1', 'q2']);
  });

  it('accepts a link supported by a single strong shared term', () => {
    expect(
      isLinkSupported(
        req('r1', 'Experience running services on Kubernetes'),
        question('q1', ['r1'], { prompt: 'Walk me through a Kubernetes rollout that went wrong.' }),
      ),
    ).toBe(true);
  });
});

describe('categoryForRequirement', () => {
  it('routes behavioural requirements to behavioural questions', () => {
    expect(categoryForRequirement(req('r1', 'Mentor juniors', 'must', 'behavioural'))).toBe('behavioural');
  });

  it('routes architecture-flavoured technical requirements to system design', () => {
    expect(categoryForRequirement(req('r1', 'Design distributed systems at scale'))).toBe('system-design');
  });

  it('routes plain technical requirements to technical', () => {
    expect(categoryForRequirement(req('r1', '5+ years with React'))).toBe('technical');
  });

  it('routes domain requirements to company fit', () => {
    expect(categoryForRequirement(req('r1', 'Fintech regulation', 'nice', 'domain'))).toBe('company-fit');
  });
});

describe('priority and kind normalisation', () => {
  // Models are asked for "must"/"nice" and often answer "required"/"nice-to-have".
  // Coercing those to a default would silently invent must-have requirements.
  it('maps the ways a model says "optional" onto nice', () => {
    for (const word of [
      'nice', 'nice to have', 'nice-to-have', 'nice_to_have', 'preferred',
      'bonus', 'desirable', 'optional', 'a plus', 'good to have',
    ]) {
      expect(normalisePriority(word)).toBe('nice');
    }
  });

  it('maps the ways a model says "required" onto must', () => {
    for (const word of ['must', 'must have', 'required', 'essential', 'mandatory', 'minimum']) {
      expect(normalisePriority(word)).toBe('must');
    }
  });

  it('treats unmarked wording as required, the way postings are written', () => {
    for (const value of ['', undefined, null, 'unknown', 42]) {
      expect(normalisePriority(value)).toBe('must');
    }
  });

  it('normalises kind, defaulting to technical', () => {
    expect(normaliseKind('behavioral')).toBe('behavioural');
    expect(normaliseKind('soft skill')).toBe('behavioural');
    expect(normaliseKind('leadership')).toBe('behavioural');
    expect(normaliseKind('domain knowledge')).toBe('domain');
    expect(normaliseKind('industry')).toBe('domain');
    expect(normaliseKind('anything else')).toBe('technical');
  });
});

describe('routing to system design', () => {
  // Found by running a real model: "designed and operated event-driven systems"
  // is a design question in any real interview, but matching only "architecture"
  // sent it to the hands-on technical prompt and left system-design empty.
  it('routes design vocabulary that is not the word "architecture"', () => {
    for (const text of [
      'You have designed and operated event-driven systems (we use Kafka)',
      'Experience with high-volume data pipelines',
      'Built services handling high throughput',
      'Familiar with message queues',
      'Comfortable with concurrency',
    ]) {
      expect(categoryForRequirement(req('r1', text))).toBe('system-design');
    }
  });

  it('still keeps ordinary tool experience in the technical category', () => {
    for (const text of ['5+ years with React', 'Strong PostgreSQL query tuning', 'Writes tests']) {
      expect(categoryForRequirement(req('r1', text))).toBe('technical');
    }
  });
});
