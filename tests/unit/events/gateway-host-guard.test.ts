import { isLocalHostHeader, allowedCorsOrigin } from '../../../src/main/events/HttpEventInterface';

describe('isLocalHostHeader — anti-DNS-rebinding (P1-5)', () => {
  it('allows 127.0.0.1 with a port', () => {
    expect(isLocalHostHeader('127.0.0.1:13000')).toBe(true);
  });
  it('allows localhost with a port', () => {
    expect(isLocalHostHeader('localhost:13000')).toBe(true);
  });
  it('allows bracketed IPv6 loopback', () => {
    expect(isLocalHostHeader('[::1]:13000')).toBe(true);
  });
  it('allows 127.0.0.1 without a port', () => {
    expect(isLocalHostHeader('127.0.0.1')).toBe(true);
  });
  it('rejects a rebound attacker domain that resolves to 127.0.0.1', () => {
    expect(isLocalHostHeader('evil.example.com:13000')).toBe(false);
  });
  it('rejects a non-loopback IP', () => {
    expect(isLocalHostHeader('10.0.0.5:13000')).toBe(false);
  });
  it('rejects a missing/empty Host header', () => {
    expect(isLocalHostHeader(undefined)).toBe(false);
    expect(isLocalHostHeader('')).toBe(false);
  });
});

describe('allowedCorsOrigin — no wildcard, localhost only (P1-5)', () => {
  it('reflects a localhost origin', () => {
    expect(allowedCorsOrigin('http://localhost:10012')).toBe('http://localhost:10012');
  });
  it('reflects a 127.0.0.1 origin', () => {
    expect(allowedCorsOrigin('http://127.0.0.1:13000')).toBe('http://127.0.0.1:13000');
  });
  it('refuses an external origin (returns null, not *)', () => {
    expect(allowedCorsOrigin('https://evil.example.com')).toBeNull();
  });
  it('refuses when no origin is present', () => {
    expect(allowedCorsOrigin(undefined)).toBeNull();
  });
});
