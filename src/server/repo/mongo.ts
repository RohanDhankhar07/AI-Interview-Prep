import { ObjectId, type Collection, type Document } from 'mongodb';
import { getDb, ensureIndexes } from '../db';
import type { KitRecord, KitRepository, UserRecord, UserRepository } from './types';

/** Mongo stores _id as ObjectId; the rest of the app only ever sees string ids. */
function toId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

/** Mongo documents are untyped at the boundary; this is the single cast site. */
function fromDoc<T>(doc: Document): T {
  const { _id, ...rest } = doc as { _id: ObjectId } & Record<string, unknown>;
  return { ...rest, id: _id.toHexString() } as T;
}

async function kits(): Promise<Collection<Document>> {
  await ensureIndexes();
  return (await getDb()).collection('kits');
}

async function users(): Promise<Collection<Document>> {
  await ensureIndexes();
  return (await getDb()).collection('users');
}

export const mongoUserRepository: UserRepository = {
  async findByEmail(email) {
    const doc = await (await users()).findOne({ email: email.toLowerCase() });
    return doc ? fromDoc<UserRecord>(doc) : null;
  },
  async findById(id) {
    const _id = toId(id);
    if (!_id) return null;
    const doc = await (await users()).findOne({ _id });
    return doc ? fromDoc<UserRecord>(doc) : null;
  },
  async create(user) {
    const result = await (await users()).insertOne({ ...user, email: user.email.toLowerCase() });
    return { ...user, id: result.insertedId.toHexString() };
  },
};

export const mongoKitRepository: KitRepository = {
  async create(record) {
    const result = await (await kits()).insertOne({ ...record });
    return { ...record, id: result.insertedId.toHexString() };
  },

  async findById(id, userId) {
    const _id = toId(id);
    if (!_id) return null;
    const doc = await (await kits()).findOne({ _id, userId });
    return doc ? fromDoc<KitRecord>(doc) : null;
  },

  async findByFingerprint(userId, fingerprint) {
    const doc = await (await kits()).findOne({ userId, fingerprint });
    return doc ? fromDoc<KitRecord>(doc) : null;
  },

  async listByUser(userId) {
    const docs = await (await kits())
      .find({ userId }, { projection: { artifacts: 0, events: 0 } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return docs.map((d) => fromDoc<KitRecord>(d));
  },

  async update(id, userId, patch) {
    const _id = toId(id);
    if (!_id) return null;
    const doc = await (await kits()).findOneAndUpdate(
      { _id, userId },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    return doc ? fromDoc<KitRecord>(doc) : null;
  },

  async remove(id, userId) {
    const _id = toId(id);
    if (!_id) return false;
    const result = await (await kits()).deleteOne({ _id, userId });
    return result.deletedCount === 1;
  },

  async acquireLease(id, userId, ms) {
    const _id = toId(id);
    if (!_id) return null;
    const now = new Date().toISOString();
    const until = new Date(Date.now() + ms).toISOString();
    // Only one request at a time may advance a kit: the filter matches an
    // expired or absent lease, so a second concurrent trigger gets nothing.
    const doc = await (await kits()).findOneAndUpdate(
      { _id, userId, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseUntil: until } },
      { returnDocument: 'after' },
    );
    return doc ? fromDoc<KitRecord>(doc) : null;
  },

  async releaseLease(id, userId) {
    const _id = toId(id);
    if (!_id) return;
    await (await kits()).updateOne({ _id, userId }, { $set: { leaseUntil: null } });
  },
};
