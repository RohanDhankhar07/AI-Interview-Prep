import type { Flashcard, Kit, Question, Requirement } from '../src/core/types';

export function req(
  id: string,
  text: string,
  priority: Requirement['priority'] = 'must',
  kind: Requirement['kind'] = 'technical',
): Requirement {
  return { id, text, kind, priority, origin: 'generated', pinned: false };
}

export function question(
  id: string,
  requirement_ids: string[],
  overrides: Partial<Question> = {},
): Question {
  return {
    id,
    requirement_ids,
    category: 'technical',
    prompt: `Tell me about ${requirement_ids.join(', ')}`,
    answer_outline: 'outline',
    difficulty: 2,
    origin: 'generated',
    pinned: false,
    ...overrides,
  };
}

export function card(id: string, requirement_ids: string[] = []): Flashcard {
  return { id, front: `front ${id}`, back: `back ${id}`, requirement_ids, origin: 'generated', pinned: false };
}

export function kit(overrides: Partial<Kit> = {}): Kit {
  const requirements = overrides.role?.requirements ?? [req('r1', 'React')];
  const questions = overrides.questions ?? [question('q1', ['r1'], { prompt: 'Explain React rendering' })];
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.example',
      role: 'Engineer',
      location: 'Remote',
      jd_chars: 500,
      researched_at: new Date().toISOString(),
      pages_used: [],
    },
    company_brief: { summary: 's', what_they_do: 'w', sources: [], origin: 'generated', pinned: false },
    role: { title: 'Engineer', seniority: 'senior', responsibilities: [], requirements, ...overrides.role },
    questions,
    flashcards: overrides.flashcards ?? [],
    schedule: overrides.schedule ?? {
      days_available: 1,
      days: [{ day: 1, focus: 'f', question_ids: questions.map((q) => q.id), minutes: 60 }],
    },
    coverage: overrides.coverage ?? { uncovered_requirement_ids: [], passes: 1 },
  };
}
