import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Every URL we fetch comes from user input or from a link inside an untrusted
 * page, so each one is validated before the request and again after every
 * redirect hop.
 *
 * Loopback and private ranges are refused in production. They are allowed when
 * ALLOW_PRIVATE_NETWORK is set, which the batch runner needs: the brief states
 * company sites may be served from a local address.
 */

export class BlockedUrlError extends Error {
  code = 'URL_BLOCKED';
}

export function privateNetworkAllowed(): boolean {
  if (process.env.ALLOW_PRIVATE_NETWORK === 'true') return true;
  if (process.env.ALLOW_PRIVATE_NETWORK === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function isPrivateAddress(address: string): boolean {
  const type = net.isIP(address);
  if (type === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (type === 6) {
    const addr = address.toLowerCase();
    if (addr === '::' || addr === '::1') return true;
    if (addr.startsWith('fe80') || addr.startsWith('fc') || addr.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:10.0.0.1)
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

export function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    try {
      url = new URL(`https://${raw.trim()}`);
    } catch {
      throw new BlockedUrlError(`Not a valid URL: ${raw}`);
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Unsupported protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('Credentials in URL are not allowed');
  }
  return url;
}

/** Throws BlockedUrlError unless the host resolves to a publicly routable address. */
export async function assertFetchable(raw: string): Promise<URL> {
  const url = parseUrl(raw);
  if (privateNetworkAllowed()) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError(`Blocked private address: ${host}`);
    return url;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedUrlError(`Blocked host: ${host}`);
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(`Host does not resolve: ${host}`);
  }
  if (records.length === 0) throw new BlockedUrlError(`Host does not resolve: ${host}`);
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new BlockedUrlError(`Blocked private address for ${host}: ${r.address}`);
    }
  }
  return url;
}
