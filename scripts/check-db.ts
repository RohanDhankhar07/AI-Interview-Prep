#!/usr/bin/env tsx
/**
 * Verifies MONGODB_URI end to end and reports which part is wrong when it is not.
 *
 *   npm run db:check
 *
 * Atlas failures all surface as one opaque timeout by default, so this separates
 * them: DNS, TCP/TLS reachability (the IP access list), authentication, and
 * finally a real write. It also creates the indexes the app depends on.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? 'interview_prep_kit';

function fail(message: string, hint?: string): never {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n  ${hint}`);
  process.exit(1);
}

/** Redacts the password so a connection string can be shown in a terminal or a log. */
function redact(value: string): string {
  return value.replace(/\/\/([^:/?#]+):([^@]+)@/, (_m, user) => `//${user}:••••••@`);
}

async function main(): Promise<void> {
  if (!uri) {
    fail('MONGODB_URI is not set.', 'Add it to .env.local. See .env.example.');
  }
  console.log(`Checking ${redact(uri)}`);
  console.log(`Database: ${dbName}\n`);

  if (/<[^>]+>/.test(uri)) {
    fail(
      `The connection string still contains a placeholder: ${uri.match(/<[^>]+>/)![0]}`,
      'Replace it with the real value. If the password contains @ : / ? # [ ] or %, it must be\n  percent-encoded — encodeURIComponent() gives you the right form.',
    );
  }

  const isSrv = uri.startsWith('mongodb+srv://');
  const host = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'https://')).hostname;

  // 1. DNS. For +srv this is also how the shard list is discovered.
  let hosts: { name: string; port: number }[];
  try {
    hosts = isSrv
      ? await dns.resolveSrv(`_mongodb._tcp.${host}`)
      : [{ name: host, port: 27017 }];
    console.log(`✓ DNS resolved ${hosts.length} host(s): ${hosts.map((h) => h.name).join(', ')}`);
  } catch (error) {
    fail(
      `DNS lookup failed for ${host}: ${(error as NodeJS.ErrnoException).code ?? error}`,
      'Check the cluster address. A deleted or paused cluster stops resolving.',
    );
  }

  // 2. TCP. This is the check that catches an IP access list problem, which
  //    otherwise looks identical to every other Atlas timeout.
  const reachable = await Promise.all(hosts.map((h) => canConnect(h.name, h.port)));
  if (!reachable.some(Boolean)) {
    fail(
      `No shard accepted a TCP connection on port 27017.`,
      'Almost always the Atlas IP access list. Atlas › Network Access › Add IP Address.\n' +
        '  Add your current IP for local use, and 0.0.0.0/0 for Vercel, whose egress IPs are not fixed\n' +
        '  on the free tier.',
    );
  }
  console.log(`✓ TCP reachable (${reachable.filter(Boolean).length}/${hosts.length} shards)`);

  // 3. TLS handshake, before the driver gets involved.
  //    A shared (M0) cluster accepts TCP from anyone — its proxy is shared — and
  //    then rejects a non-allowlisted IP during the TLS handshake. Without this
  //    stage that shows up as an OpenSSL "alert number 80", which reads like a
  //    local TLS problem and is nothing of the kind.
  const target = hosts[reachable.findIndex(Boolean)];
  const handshake = await tlsHandshake(target.name, target.port);
  if (!handshake.ok) {
    if (/internal error|alert number 80|handshake failure/i.test(handshake.error ?? '')) {
      fail(
        `TLS was refused by ${target.name} before any credentials were sent.`,
        `On a shared cluster this means your IP is not on the Atlas access list.\n` +
          `  Atlas › Network Access › Add IP Address:\n` +
          `    · this machine: ${await publicIp()}\n` +
          `    · Vercel:       0.0.0.0/0  (its egress IPs are not fixed on the free tier)\n` +
          `  Changes take a minute to apply. The password is not the problem — a bare TLS\n` +
          `  handshake with no credentials is being rejected.`,
      );
    }
    fail(`TLS handshake failed with ${target.name}: ${handshake.error}`);
  }
  console.log('✓ TLS handshake accepted (this IP is on the access list)');

  // 4. Authenticate, then actually write — read-only credentials pass a ping.
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12_000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 });
    console.log('✓ Authenticated');

    const probe = db.collection('_connectivity_probe');
    const { insertedId } = await probe.insertOne({ at: new Date().toISOString() });
    await probe.deleteOne({ _id: insertedId });
    console.log('✓ Write and delete succeeded');

    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('kits').createIndex({ userId: 1, updatedAt: -1 });
    await db.collection('kits').createIndex({ userId: 1, fingerprint: 1 }, { unique: true });
    console.log('✓ Indexes created (unique email, unique kit fingerprint per user)');

    const names = await db.listCollections().toArray();
    console.log(
      `\nCollections in ${dbName}: ${names.map((c) => c.name).join(', ') || '(none yet)'}`,
    );
    console.log('\n✓ MONGODB_URI is good. The app will use this database.');
  } catch (error) {
    const message = (error as Error).message;
    if (/Authentication failed|bad auth/i.test(message)) {
      fail(
        'Authentication failed — the cluster is reachable but the username or password is wrong.',
        'Check Atlas › Database Access. If the password has special characters, percent-encode it.',
      );
    }
    if (/not authorized|Unauthorized/i.test(message)) {
      fail(
        `Authenticated, but this user cannot write to "${dbName}".`,
        'Give the user readWrite on this database (Atlas › Database Access › Edit › Built-in Role).',
      );
    }
    fail(`Connection failed: ${message}`);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Handshake only. Tells an access-list rejection apart from a credentials problem. */
function tlsHandshake(
  host: string,
  port: number,
  timeoutMs = 8000,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host }, () => {
      socket.destroy();
      resolve({ ok: true });
    });
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'timed out' });
    });
    socket.once('error', (error) => {
      socket.destroy();
      resolve({ ok: false, error: (error as Error).message.split('\n')[0] });
    });
  });
}

/** Best-effort, and only used to print a helpful hint. */
async function publicIp(): Promise<string> {
  try {
    const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) });
    return (await response.text()).trim() || 'check whatismyip.com';
  } catch {
    return 'check whatismyip.com';
  }
}

/** A plain TCP probe: reachable or not, with no driver retry logic in the way. */
function canConnect(host: string, port: number, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
