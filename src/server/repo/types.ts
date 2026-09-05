import type { Kit } from '../../core/types';
import type { PipelineEvent, PipelineState, StepName } from '../../core/pipeline';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

/** How confident the user felt, and when the card is next due. */
export interface PracticeRecord {
  cardId: string;
  confidence: 1 | 2 | 3;
  reps: number;
  lastSeenAt: string;
  dueAt: string;
}

export interface KitRecord {
  id: string;
  userId: string;
  title: string;
  fingerprint: string;
  input: PipelineState['input'];
  status: PipelineState['status'];
  step: StepName;
  completed: StepName[];
  passes: number;
  error: PipelineState['error'];
  events: PipelineEvent[];
  artifacts: PipelineState['artifacts'];
  /** Research findings later steps need; see ResearchContext in core/pipeline. */
  context?: PipelineState['context'];
  kit: Kit;
  /** Held by whichever request is currently advancing the pipeline. */
  leaseUntil: string | null;
  /**
   * Set once the user edits a schedule day by hand. After that we never
   * re-allocate on their behalf, because that would discard their edit — we tell
   * them the schedule is out of date instead.
   */
  scheduleEdited?: boolean;
  practice: Record<string, PracticeRecord>;
  createdAt: string;
  updatedAt: string;
}

export interface KitRepository {
  create(record: Omit<KitRecord, 'id'>): Promise<KitRecord>;
  findById(id: string, userId: string): Promise<KitRecord | null>;
  findByFingerprint(userId: string, fingerprint: string): Promise<KitRecord | null>;
  listByUser(userId: string): Promise<KitRecord[]>;
  update(id: string, userId: string, patch: Partial<KitRecord>): Promise<KitRecord | null>;
  remove(id: string, userId: string): Promise<boolean>;
  /** Atomically take the generation lease. Returns null when someone else holds it. */
  acquireLease(id: string, userId: string, ms: number): Promise<KitRecord | null>;
  releaseLease(id: string, userId: string): Promise<void>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(user: Omit<UserRecord, 'id'>): Promise<UserRecord>;
}
