import { MongoClient, type Db } from 'mongodb';

/**
 * One client per process, cached across hot reloads and warm serverless
 * invocations. Mongo's driver pools connections, so this is the connection
 * strategy Vercel wants.
 */

const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    }).connect();
  }
  const client = await globalForMongo._mongoClient;
  return client.db(process.env.MONGODB_DB ?? 'interview_prep_kit');
}

let indexesReady: Promise<void> | null = null;

/** Idempotent; the unique indexes are what make duplicate submission a no-op. */
export async function ensureIndexes(): Promise<void> {
  indexesReady ??= (async () => {
    const db = await getDb();
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('kits').createIndex({ userId: 1, updatedAt: -1 });
    await db.collection('kits').createIndex({ userId: 1, fingerprint: 1 }, { unique: true });
  })();
  return indexesReady;
}
