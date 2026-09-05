import { describe, expect, it } from 'vitest';
import { validateKit, uncoveredMustHaves } from '../src/core/validate';
import { card, kit, question, req } from './helpers';

describe('validateKit', () => {
  it('accepts a well-formed kit', () => {
    expect(validateKit(kit()).ok).toBe(true);
  });

  it('rejects a kit missing a required Appendix A field', () => {
    const broken = kit() as Record<string, unknown>;
    delete broken.coverage;
    const result = validateKit(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('coverage');
  });

  it('rejects a non-integer duration', () => {
    const result = validateKit(
      kit({ schedule: { days_available: 1, days: [{ day: 1, focus: 'f', question_ids: [], minutes: 42.5 }] } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/minutes|integer/i);
  });

  it('rejects a difficulty outside 1-3', () => {
    const result = validateKit(kit({ questions: [question('q1', ['r1'], { difficulty: 5 as 1 })] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a schedule that references a question that does not exist', () => {
    const result = validateKit(
      kit({ schedule: { days_available: 1, days: [{ day: 1, focus: 'f', question_ids: ['q404'], minutes: 30 }] } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('q404');
  });

  it('rejects a schedule whose day count disagrees with days_available', () => {
    const result = validateKit(
      kit({ schedule: { days_available: 3, days: [{ day: 1, focus: 'f', question_ids: [], minutes: 30 }] } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('days_available');
  });

  it('rejects a question pointing at an unknown requirement', () => {
    const result = validateKit(kit({ questions: [question('q1', ['r404'])] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('r404');
  });

  it('rejects duplicate ids', () => {
    const result = validateKit(kit({ questions: [question('q1', ['r1']), question('q1', ['r1'])] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('duplicate');
  });

  it('rejects a flashcard pointing at an unknown requirement', () => {
    const result = validateKit(kit({ flashcards: [card('f1', ['r404'])] }));
    expect(result.ok).toBe(false);
  });

  it('defaults provenance fields so a kit without them still validates', () => {
    const raw = JSON.parse(JSON.stringify(kit())) as Record<string, unknown>;
    const questions = raw.questions as Record<string, unknown>[];
    delete questions[0].origin;
    delete questions[0].pinned;
    const result = validateKit(raw);
    expect(result.ok).toBe(true);
    expect(result.kit!.questions[0].origin).toBe('generated');
  });
});

describe('uncoveredMustHaves', () => {
  it('names must-have requirements with no question at all', () => {
    const target = kit({
      role: {
        title: 'Engineer',
        seniority: 'senior',
        responsibilities: [],
        requirements: [req('r1', 'React'), req('r2', 'Kubernetes')],
      },
      questions: [question('q1', ['r1'])],
    });
    expect(uncoveredMustHaves(target)).toEqual(['r2']);
  });
});

describe('Appendix A contract', () => {
  // These field names are fixed by the brief. If this test fails, the kit no
  // longer matches the structure the grader parses.
  it('uses exactly the field names the brief specifies', () => {
    const target = validateKit(kit()).kit!;

    expect(Object.keys(target).sort()).toEqual(
      ['company_brief', 'coverage', 'flashcards', 'questions', 'role', 'schedule', 'source'].sort(),
    );
    expect(Object.keys(target.source).sort()).toEqual(
      ['company', 'company_url', 'jd_chars', 'location', 'pages_used', 'researched_at', 'role'].sort(),
    );
    expect(Object.keys(target.role).sort()).toEqual(
      ['requirements', 'responsibilities', 'seniority', 'title'].sort(),
    );
    expect(Object.keys(target.schedule).sort()).toEqual(['days', 'days_available'].sort());
    expect(Object.keys(target.schedule.days[0]).sort()).toEqual(
      ['day', 'focus', 'minutes', 'question_ids'].sort(),
    );
    expect(Object.keys(target.coverage).sort()).toEqual(
      ['passes', 'uncovered_requirement_ids'].sort(),
    );
    // Provenance is our own addition; the brief's own fields must all be present.
    for (const field of ['id', 'requirement_ids', 'category', 'prompt', 'answer_outline', 'difficulty']) {
      expect(target.questions[0]).toHaveProperty(field);
    }
    for (const field of ['id', 'text', 'kind', 'priority']) {
      expect(target.role.requirements[0]).toHaveProperty(field);
    }
    for (const field of ['summary', 'what_they_do', 'sources']) {
      expect(target.company_brief).toHaveProperty(field);
    }
  });
});

describe('published interview stages', () => {
  it('are carried in the kit so the candidate can see what they face', () => {
    const target = kit();
    target.research = {
      crawled_pages: 7,
      hiring_process_found: true,
      hiring_process_urls: ['https://example.com/handbook/hiring'],
      hiring_process_summary: 'Four rounds.',
      hiring_process_stages: [
        { name: 'Take-home', description: 'Paid, three hours.' },
        { name: 'System design', description: '75 minutes.' },
      ],
      public_discussion_found: false,
      public_discussion_urls: [],
      public_discussion_summary: '',
      skipped_sources: [],
      notes: [],
    };
    const result = validateKit(target);
    expect(result.ok).toBe(true);
    expect(result.kit!.research!.hiring_process_stages).toHaveLength(2);
  });

  it('default to empty for a company that publishes nothing', () => {
    const result = validateKit({
      ...kit(),
      research: { crawled_pages: 1, hiring_process_found: false },
    });
    expect(result.ok).toBe(true);
    expect(result.kit!.research!.hiring_process_stages).toEqual([]);
  });
});
