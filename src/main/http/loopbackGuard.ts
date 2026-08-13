/**
 * Loopback HTTP guards, shared by every localhost server in the main process
 * (HttpEventInterface, McpServer, AiProxyServer).
 *
 * All three bind 127.0.0.1, but binding loopback does NOT stop DNS rebinding: a
 * web page the user visits can point a hostname it controls at 127.0.0.1 and
 * have the browser send requests carrying that hostname in the Host header.
 * Requiring a loopback Host, and never echoing a wildcard CORS origin, is what
 * actually closes that hole — so it must be identical on every server, not just
 * the one that happened to get hardened first (P1-8: two of three had wildcard
 * CORS and no Host check).
 */

/**
 * True only if the HTTP Host header names a loopback address. A legitimate
 * local caller sends a loopback Host; a DNS-rebinding request from a visited web
 * page carries the attacker's own hostname. Port is ignored.
 */
export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  // Strip the port. For bracketed IPv6 ("[::1]:13000") the port follows the closing bracket.
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return hostname === '127.0.0.1'
    || hostname === 'localhost'
    || hostname === '[::1]'
    || hostname === '::1';
}

/**
 * Returns the Origin to echo in Access-Control-Allow-Origin, or null to send no
 * CORS header. Only loopback origins are allowed — never the wildcard `*`. A
 * non-loopback web origin gets no header, so its JavaScript cannot read
 * responses.
 */
export function allowedCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin) ? origin : null;
}
