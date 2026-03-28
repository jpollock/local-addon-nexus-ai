import * as crypto from 'crypto';
import * as http from 'http';

const TRUSTED_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generates and validates Bearer tokens for MCP server authentication.
 */
export class McpAuth {
  private token: string;

  constructor(existingToken?: string) {
    this.token = existingToken ?? McpAuth.generateToken();
  }

  static generateToken(): string {
    return crypto.randomBytes(64).toString('base64');
  }

  getToken(): string {
    return this.token;
  }

  /**
   * Validate an incoming HTTP request. Returns null on success, error message on failure.
   */
  validate(req: http.IncomingMessage): string | null {
    // Check IP
    const ip = req.socket.remoteAddress ?? '';
    if (!TRUSTED_IPS.has(ip)) {
      return `Connection from untrusted IP: ${ip}`;
    }

    // Check Authorization header
    const authHeader = req.headers.authorization ?? '';
    let providedToken = '';

    if (authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7);
    } else if (authHeader) {
      providedToken = authHeader; // Accept raw token too
    }

    if (!providedToken) {
      return 'Missing Authorization header';
    }

    if (!safeCompare(providedToken, this.token)) {
      return 'Invalid authentication token';
    }

    return null;
  }
}
