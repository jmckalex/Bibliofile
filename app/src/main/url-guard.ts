/**
 * Guards for URLs the MAIN process is asked to fetch on the renderer's behalf.
 *
 * `fetchPdfBytes` hands main a URL and returns the bytes, which makes main a
 * proxy: without a check, the renderer (or anything that achieved script
 * execution in it) can have a trusted, non-sandboxed process issue GETs to
 * loopback, RFC-1918 hosts, or the cloud metadata endpoint at 169.254.169.254,
 * and infer results from what comes back (audit rpt-02 SEV-7 / rpt-04 SEV-M3).
 *
 * Two independent defences, because either alone is weak:
 *  1. an ALLOWLIST — main only fetches URLs it surfaced itself (see
 *     `remember`/`isRemembered`), so a URL the renderer invented is refused
 *     outright, whatever it points at;
 *  2. this module — the URL must be plain https to a host that is not
 *     obviously internal, re-checked on every redirect hop.
 *
 * KNOWN LIMIT: the host check is lexical. A public DNS name that RESOLVES to a
 * private address (DNS rebinding) still passes. Closing that needs
 * resolve-then-pin-the-socket, which Node's fetch doesn't expose; the allowlist
 * is what actually carries the security argument, and this is defence in depth.
 */

/** Hostnames that are never fetchable, however they are spelled. */
const BLOCKED_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'broadcasthost']);

/** Decimal-dotted IPv4 → its four octets, or undefined if it isn't one. */
function ipv4Octets(host: string): number[] | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return undefined;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : undefined;
}

/** Is this literal IPv4 address one we must never fetch? */
function isPrivateIpv4(o: number[]): boolean {
  const [a, b] = o as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
  if (a === 192 && b === 0) return true; // IETF protocol assignments / test-net
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Is this literal IPv6 address one we must never fetch? */
function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true; // unspecified / loopback
  if (h.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // unique local (fc00::/7)
  // IPv4-mapped — judge the embedded v4 address. WHATWG URL normalises the
  // dotted form to hex (`::ffff:10.0.0.1` → `::ffff:a00:1`), so accept both or
  // the mapped-private case slips straight through.
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (dotted) {
    const o = ipv4Octets(dotted[1]!);
    return o ? isPrivateIpv4(o) : true;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  return false;
}

/**
 * May main fetch this URL at all? Requires https and a host that isn't loopback,
 * private, link-local or otherwise internal. Anything unparseable is refused.
 */
export function isPubliclyFetchable(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // https only: http would also let a network attacker see and rewrite what main
  // fetches, and every legitimate OA host serves https.
  if (url.protocol !== 'https:') return false;
  // Embedded credentials are never needed here and smell like an attack.
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_NAMES.has(host)) return false;
  // `.local` is mDNS; `.internal` is the conventional private-cloud suffix.
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.includes(':') || host.startsWith('[')) return !isPrivateIpv6(host);
  const octets = ipv4Octets(host);
  if (octets) return !isPrivateIpv4(octets);
  // A plain DNS name. Must contain a dot: bare names are intranet hosts.
  return host.includes('.');
}

/**
 * URLs main has itself surfaced to the renderer (open-access locator results),
 * and will therefore fetch on request.
 *
 * Bounded: a long session must not accumulate unboundedly, and the oldest
 * entries are the least likely to be re-requested. Insertion order is Map order,
 * so the oldest key is simply the first.
 */
const MAX_REMEMBERED = 4000;
const fetchable = new Set<string>();

/** Record a URL main surfaced, so a later `fetchPdfBytes` for it is allowed. */
export function rememberFetchableUrl(url: string): void {
  if (!isPubliclyFetchable(url)) return; // never remember what we'd refuse anyway
  if (fetchable.size >= MAX_REMEMBERED) {
    const oldest = fetchable.values().next().value;
    if (oldest !== undefined) fetchable.delete(oldest);
  }
  fetchable.add(url);
}

/** Did main surface this URL earlier in the session? */
export function isRememberedUrl(url: string): boolean {
  return fetchable.has(url);
}

/** Tests only. */
export function __clearRememberedUrls(): void {
  fetchable.clear();
}
