/**
 * Token manager for AI Gateway authentication
 */

import * as crypto from 'crypto';
import { safeStorage } from 'electron';
import { SiteToken } from './types';
import type { RegistryStorage } from '../content/IndexRegistry';

const STORAGE_KEY = 'nexus_ai_gateway_tokens';

/**
 * P1-4: gateway bearer tokens are a live credential — anyone holding one authenticates to the AI
 * gateway as that site. They used to be persisted as a plaintext object, beside the
 * safeStorage-encrypted API keys. Encrypt the whole map at rest via Electron safeStorage,
 * mirroring KeyVault: base64(safeStorage.encryptString(json)). If OS-backed encryption is
 * unavailable (e.g. a Linux box with no keyring), fall back to a plaintext JSON string — the same
 * degradation KeyVault accepts — rather than failing the gateway.
 */
function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encodeTokens(map: Record<string, SiteToken>): string {
  const json = JSON.stringify(map);
  if (!encryptionAvailable()) return json; // plaintext-string fallback
  return safeStorage.encryptString(json).toString('base64');
}

function decodeTokens(raw: unknown): Record<string, SiteToken> {
  if (raw == null) return {};
  // Legacy plaintext: the value was stored as the object map itself.
  if (typeof raw === 'object') return raw as Record<string, SiteToken>;
  if (typeof raw !== 'string') return {};
  if (encryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(raw, 'base64'))) as Record<string, SiteToken>;
    } catch {
      // Not ciphertext — likely a plaintext-fallback JSON string written on a keyring-less box.
    }
  }
  try {
    return JSON.parse(raw) as Record<string, SiteToken>;
  } catch {
    return {};
  }
}

function persistTokens(storage: RegistryStorage, map: Record<string, SiteToken>): void {
  storage.set(STORAGE_KEY, encodeTokens(map) as unknown as Record<string, SiteToken>);
}

/**
 * Generate a new authentication token for a site
 */
export function generateToken(): string {
  return crypto.randomUUID();
}

/**
 * Store a site token mapping
 */
export function storeSiteToken(
  storage: RegistryStorage,
  siteId: string,
  siteName: string,
  token: string,
): void {
  const tokens = getAllSiteTokens(storage);
  tokens[token] = {
    siteId,
    siteName,
    token,
    createdAt: Date.now(),
  };
  persistTokens(storage, tokens);
}

/**
 * Get all site tokens. Migrates a legacy plaintext object to the encrypted form on first read.
 */
export function getAllSiteTokens(storage: RegistryStorage): Record<string, SiteToken> {
  const raw = storage.get(STORAGE_KEY);
  const map = decodeTokens(raw);
  // A legacy plaintext object (or nothing) — re-persist encrypted, once.
  if (raw !== null && typeof raw === 'object') {
    persistTokens(storage, map);
  }
  return map;
}

/**
 * Lookup site ID from token
 */
export function getSiteIdFromToken(
  storage: RegistryStorage,
  token: string,
): string | null {
  const tokens = getAllSiteTokens(storage);
  const siteToken = tokens[token];
  return siteToken ? siteToken.siteId : null;
}

/**
 * Get token for a site (or generate if doesn't exist)
 */
export function getOrCreateSiteToken(
  storage: RegistryStorage,
  siteId: string,
  siteName: string,
): string {
  // Check if token already exists for this site
  const tokens = getAllSiteTokens(storage);
  for (const [token, siteToken] of Object.entries(tokens)) {
    if (siteToken.siteId === siteId) {
      return token;
    }
  }

  // Generate new token
  const token = generateToken();
  storeSiteToken(storage, siteId, siteName, token);
  return token;
}

/**
 * Revoke a site's token
 */
export function revokeSiteToken(storage: RegistryStorage, siteId: string): void {
  const tokens = getAllSiteTokens(storage);
  const updatedTokens: Record<string, SiteToken> = {};

  for (const [token, siteToken] of Object.entries(tokens)) {
    if (siteToken.siteId !== siteId) {
      updatedTokens[token] = siteToken;
    }
  }

  persistTokens(storage, updatedTokens);
}
