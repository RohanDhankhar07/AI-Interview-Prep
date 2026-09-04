import { randomUUID } from 'node:crypto';
import type { KitRecord, KitRepository, UserRecord, UserRepository } from './types';

/**
 * In-memory repositories for local development without a database.
 * Never used in production: `getRepositories()` refuses to select this when
 * NODE_ENV is production, so a missing MONGODB_URI fails loudly there instead of
 * silently losing every kit on the next cold start.
 */

const store = globalThis as unknown as {
  _memUsers?: Map<string, UserRecord>;
  _memKits?: Map<string, KitRecord>;
};
store._memUsers ??= new Map();
store._memKits ??= new Map();

const usersById = store._memUsers;
const kitsById = store._memKits;

export const memoryUserRepository: UserRepository = {
  async findByEmail(email) {
    return [...usersById.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  },
  async findById(id) {
    return usersById.get(id) ?? null;
  },
  async create(user) {
    const record = { ...user, email: user.email.toLowerCase(), id: randomUUID() };
    usersById.set(record.id, record);
    return record;
  },
};

export const memoryKitRepository: KitRepository = {
  async create(record) {
    const created = { ...record, id: randomUUID() } as KitRecord;
    kitsById.set(created.id, created);
    return created;
  },
  async findById(id, userId) {
    const record = kitsById.get(id);
    return record && record.userId === userId ? record : null;
  },
  async findByFingerprint(userId, fingerprint) {
    return (
      [...kitsById.values()].find((k) => k.userId === userId && k.fingerprint === fingerprint) ?? null
    );
  },
  async listByUser(userId) {
    return [...kitsById.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async update(id, userId, patch) {
    const record = kitsById.get(id);
    if (!record || record.userId !== userId) return null;
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
    kitsById.set(id, next);
    return next;
  },
  async remove(id, userId) {
    const record = kitsById.get(id);
    if (!record || record.userId !== userId) return false;
    kitsById.delete(id);
    return true;
  },
  async acquireLease(id, userId, ms) {
    const record = kitsById.get(id);
    if (!record || record.userId !== userId) return null;
    const now = Date.now();
    if (record.leaseUntil && Date.parse(record.leaseUntil) > now) return null;
    const next = { ...record, leaseUntil: new Date(now + ms).toISOString() };
    kitsById.set(id, next);
    return next;
  },
  async releaseLease(id, userId) {
    const record = kitsById.get(id);
    if (record && record.userId === userId) kitsById.set(id, { ...record, leaseUntil: null });
  },
};
