/**
 * fixes-082526 · issue 8 — the clipped line.
 *
 * The designer's highest-value item: it makes the grant-gates-nothing state
 * visible ON the surface that grants it, and it is DERIVED from bound ×
 * capability so it cannot disagree with the bound the way a per-row string
 * would. These tests are mostly about what it REFUSES to say.
 */
import { deriveClippedLine, grantGatesNothing, joinPlaces, type Bound } from '../../../src/renderer/components/settings/permissionsPane';

const bound: Bound = {
  places: ['your machine', 'staging', 'production'],
  rows: [
    { op: 'Copy a site down', transport: 'WP Engine', states: ['allowed', 'allowed', 'allowed'] },
    { op: 'Install or update things', transport: 'WP Engine + SSH', states: ['allowed', 'allowed', 'blocked'] },
    { op: 'Delete or promote an environment', transport: 'WP Engine', states: ['blocked', 'blocked', 'blocked'] },
  ],
};

const grant = (over: Partial<Parameters<typeof deriveClippedLine>[1]> = {}) => ({
  cap: 'cap.x', label: 'X', state: 'granted' as const, needs: 'Install or update things', ...over,
});

describe('the clipped line', () => {
  it('states what runs, what is barred, and what bars it', () => {
    expect(deriveClippedLine(bound, grant())).toBe(
      'Runs on your machine and staging. Blocked on production by the write bound.',
    );
  });

  it('says so plainly when a grant reaches nothing at all', () => {
    const line = deriveClippedLine(bound, grant({ needs: 'Delete or promote an environment' }));
    expect(line).toMatch(/gates nothing/);
    expect(grantGatesNothing(bound, grant({ needs: 'Delete or promote an environment' }))).toBe(true);
  });

  it('a bound clips only what was GRANTED — a denied row gets no second reason', () => {
    // The pin: its denial is the reason. Naming the bound too would imply two.
    expect(deriveClippedLine(bound, grant({ state: 'denied' }))).toBeNull();
    expect(grantGatesNothing(bound, grant({ state: 'denied' }))).toBe(false);
  });

  it('says nothing when the bound blocks nothing — a line that clips nothing is noise', () => {
    expect(deriveClippedLine(bound, grant({ needs: 'Copy a site down' }))).toBeNull();
  });

  it('says nothing for a capability that needs no write', () => {
    expect(deriveClippedLine(bound, grant({ needs: '' }))).toBeNull();
  });

  it('does not guess about an operation the bound does not carry', () => {
    expect(deriveClippedLine(bound, grant({ needs: 'Reticulate splines' }))).toBeNull();
  });

  it('MOVES WITH THE BOUND — the property a per-row string cannot have', () => {
    const loosened: Bound = {
      ...bound,
      rows: bound.rows.map((r) =>
        r.op === 'Install or update things' ? { ...r, states: ['allowed', 'allowed', 'allowed'] as any } : r,
      ),
    };
    // Same grant, changed bound: the line disappears without anyone editing a row.
    expect(deriveClippedLine(bound, grant())).toMatch(/Blocked on production/);
    expect(deriveClippedLine(loosened, grant())).toBeNull();
  });

  it('reads as a sentence, whatever the number of places', () => {
    expect(joinPlaces(['a'])).toBe('a');
    expect(joinPlaces(['a', 'b'])).toBe('a and b');
    expect(joinPlaces(['a', 'b', 'c'])).toBe('a, b and c');
    expect(joinPlaces([])).toBe('');
  });
});
