/**
 * Token manager for AI Gateway authentication
 */

import * as crypto from 'crypto';
import { SiteToken } from './types';
import type { RegistryStorage } from '../content/IndexRegistry';

const STORAGE_KEY = 'nexus_ai_gateway_tokens';

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
  storage.set(STORAGE_KEY, tokens);
}

/**
 * Get all site tokens
 */
export function getAllSiteTokens(storage: RegistryStorage): Record<string, SiteToken> {
  return (storage.get(STORAGE_KEY) as Record<string, SiteToken>) ?? {};
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

  storage.set(STORAGE_KEY, updatedTokens);
}
