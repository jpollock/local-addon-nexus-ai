/**
 * One source for what Nexus may do on an external host.
 *
 * The empty state and the host detail screen both render from this, so they
 * cannot drift apart (spec C3). An earlier revision of the design hand-authored
 * each list and they disagreed — the empty state omitted a capability the other
 * promised.
 */
import { GRID_ROWS } from './PermissionsSection';

export type CapabilityState = 'allowed' | 'gated' | 'unavailable';

export interface Capability {
  id: string;
  label: string;
  state: CapabilityState;
  /** Why it is gated or unavailable. Absent for plainly-allowed rows. */
  note?: string;
}

/**
 * Reading is not a permission (spec C4) — it is how Nexus answers at all, so it
 * is not in GRID_ROWS and is stated here as a fixed row.
 */
const READ_ROW: Capability = {
  id: 'read',
  label: 'Read what is installed, and make it searchable',
  state: 'allowed',
};

export function externalHostCapabilities(): Capability[] {
  const fromGrid: Capability[] = GRID_ROWS.map((row) => {
    if (row.scope === 'both') {
      // wpcli is the only route by which an external site can be written to,
      // and it is still subject to the environment cells in What agents may do.
      // Flattening it to allowed or unavailable is wrong in both directions.
      return {
        id: row.id,
        label: row.label,
        state: 'gated' as const,
        note: 'If you allow it under What agents may do',
      };
    }
    return {
      id: row.id,
      label: row.label,
      state: 'unavailable' as const,
      note: 'WP Engine only',
    };
  });

  return [READ_ROW, ...fromGrid];
}
