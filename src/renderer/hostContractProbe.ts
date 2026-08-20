/**
 * WP-47 · THE DUAL-TRACK CAPABILITY PROBE — what THIS host supports, asked of the host.
 *
 * Named for what it is, after WP-47's gate ruling: this file was `hostCapabilities.ts`
 * and collided by NAME with `components/settings/hostCapabilities.ts`, which is about an
 * external SSH host's *permissions* in the Govern matrix. Two files a directory apart
 * with the same name and different meanings is a trap, and a header paragraph is not a
 * fix for one. This module is about LOCAL — the application our renderer is loaded into
 * — and which parts of the host contract it exposes.
 *
 * ## Why a probe and not a version check
 *
 * The designer's plan of record makes every phase of the inversion ship "behind host
 * capability, not behind a flag someone remembers to flip. A flag is a decision that
 * expires; a capability check is a fact about the host." The Local architect's recon §6
 * reaches the same shape from the other side and specifies it: a plain object on the
 * renderer addon context, integer-versioned per capability, absent = unsupported,
 * "degrades correctly for old hosts because undefined is falsy". Capability detection is
 * therefore not a fifth ask in the host contract — it is the shape of each of the four.
 *
 * On stock Local 10.1.1 there is no such member (recon §6: "There is no capability API").
 * Every probe here returns false against it, and every caller runs the guest path it runs
 * today. That is the whole point: the contract track and the guest track are one codebase.
 *
 * ## Rules this module enforces
 *
 * - **A capability is never inferred from a version.** `version` is recorded alongside as
 *   the fallback signal — a support log wants to know which Local a user is on — and
 *   `has()` never reads it. Version-sniffing is what the capability member replaces.
 * - **Only a usable integer level counts.** `0`, a negative, a fraction, a string, a
 *   boolean: all dropped. Presence of an unreadable member is not support, and treating
 *   it as support would light up a path the host cannot serve.
 * - **Never throws.** A hostile or malformed context degrades to the guest track. An
 *   addon that crashes while asking what the host supports has answered the question
 *   badly.
 * - **The map is frozen and copied.** No caller can grant itself a capability, and a host
 *   object mutated later cannot retroactively change what we probed.
 */

/** The four contract items, as reshaped by host contract v2 (SHELL_INVERSION_PLAN Amendment 2). */
export type HostCapabilityName =
  | 'themeTokens'
  | 'mainVerticalNav'
  | 'layoutReservation'
  | 'regionProviders';

/**
 * Declared in the order the contract proposes them, which is also the order the recon
 * ranked them by cost. Exported so a test can assert the whole set degrades, rather than
 * asserting the four names someone remembered to list.
 */
export const HOST_CAPABILITIES: readonly HostCapabilityName[] = Object.freeze([
  'themeTokens',
  'mainVerticalNav',
  'layoutReservation',
  'regionProviders',
] as const);

/**
 * What we read off the host. Unknown members are KEPT (a host two versions newer will
 * advertise capabilities this build has never heard of) but nothing can key on them:
 * `has()` is typed to the declared names.
 */
export type HostCapabilityMap = Readonly<Record<string, number>>;

export interface HostProbe {
  /** Every usable integer member the host advertised. Frozen. */
  readonly capabilities: HostCapabilityMap;
  /** `context.environment.version`, or null when the host did not state one. */
  readonly version: string | null;
  /** The advertised level, or undefined when the host does not offer it. */
  level(name: HostCapabilityName): number | undefined;
  /** True only when the host advertises `name` at `atLeast` or higher. Never reads `version`. */
  has(name: HostCapabilityName, atLeast?: number): boolean;
  /** One line for a log: `host=10.1.1 capabilities=none`. */
  summary(): string;
}

/** Property access that cannot throw, whatever the caller handed us. */
function read(target: unknown, key: string): unknown {
  if (target === null || typeof target !== 'object') return undefined;
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function isUsableLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function readCapabilities(context: unknown): HostCapabilityMap {
  const raw = read(context, 'capabilities');
  // An array is an object but is not a capability namespace; treating it as one would
  // read indices as capability names.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return Object.freeze({});
  const out: Record<string, number> = {};
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const value = read(raw, key);
    if (isUsableLevel(value)) out[key] = value;
  }
  return Object.freeze(out);
}

function readVersion(context: unknown): string | null {
  const version = read(read(context, 'environment'), 'version');
  return typeof version === 'string' ? version : null;
}

/**
 * Probe a renderer addon context for the host contract.
 *
 * @param context Local's renderer addon context (`RendererAddonLoader`'s argument). Any
 *   value is accepted, because the whole point is that we do not control what we get.
 */
export function probeHost(context: unknown): HostProbe {
  const capabilities = readCapabilities(context);
  const version = readVersion(context);

  const level = (name: HostCapabilityName): number | undefined =>
    Object.prototype.hasOwnProperty.call(capabilities, name) ? capabilities[name] : undefined;

  return {
    capabilities,
    version,
    level,
    has(name: HostCapabilityName, atLeast = 1): boolean {
      const found = level(name);
      return found !== undefined && found >= atLeast;
    },
    summary(): string {
      const names = Object.keys(capabilities).sort();
      const advertised = names.length
        ? names.map((n) => `${n}@${capabilities[n]}`).join(',')
        : 'none';
      return `host=${version ?? 'unknown'} capabilities=${advertised}`;
    },
  };
}
