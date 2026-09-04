import { isDatabaseConfigured } from '../db';
import { memoryKitRepository, memoryUserRepository } from './memory';
import { mongoKitRepository, mongoUserRepository } from './mongo';
import type { KitRepository, UserRepository } from './types';

export function getRepositories(): { users: UserRepository; kits: KitRepository } {
  if (isDatabaseConfigured()) {
    return { users: mongoUserRepository, kits: mongoKitRepository };
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI must be set in production.');
  }
  return { users: memoryUserRepository, kits: memoryKitRepository };
}

export type { KitRecord, UserRecord, PracticeRecord } from './types';
