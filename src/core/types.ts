import { z } from 'zod';

/**
 * The kit structure is fixed by Appendix A of the brief. Field names and shapes
 * below must match it exactly; we extend it only with additive fields that the
 * builder needs (`origin`, `pinned`, `research`), never by renaming or removing.
 */

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'] as const;
export const PRIORITIES = ['must', 'nice'] as const;
export const QUESTION_CATEGORIES = [
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

/**
 * Provenance of an item, which is what makes a regeneration safe.
 * - `generated`: written by the model and untouched by the user -> replaceable.
 * - `edited`:    generated then edited by the user               -> preserved.
 * - `manual`:    authored by the user                            -> preserved.
 * `pinned` is an explicit user override that preserves an item regardless.
 */
export const OriginSchema = z.enum(['generated', 'edited', 'manual']);
export type Origin = z.infer<typeof OriginSchema>;

const provenance = {
  origin: OriginSchema.default('generated'),
  pinned: z.boolean().default(false),
};

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  ...provenance,
});

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
  ...provenance,
});

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});

export const QuestionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  ...provenance,
});

export const FlashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  ...provenance,
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().nonnegative(),
});

export const ScheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(ScheduleDaySchema),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().nonnegative(),
});

/** Additive: an honest, machine-readable record of what research did and did not find. */
export const ResearchSchema = z.object({
  crawled_pages: z.number().int().nonnegative().default(0),
  hiring_process_found: z.boolean().default(false),
  hiring_process_urls: z.array(z.string()).default([]),
  hiring_process_summary: z.string().default(''),
  public_discussion_found: z.boolean().default(false),
  public_discussion_urls: z.array(z.string()).default([]),
  public_discussion_summary: z.string().default(''),
  skipped_sources: z
    .array(z.object({ url: z.string(), reason: z.string() }))
    .default([]),
  notes: z.array(z.string()).default([]),
});

export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  research: ResearchSchema.optional(),
});

export type Kit = z.infer<typeof KitSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;
export type Research = z.infer<typeof ResearchSchema>;
export type Role = z.infer<typeof RoleSchema>;
