/**
 * WP-13 · The eval fixture fleet, seeded through the REAL intelligence core.
 *
 * "Executes against the REAL intelligence core" is the packet's requirement and
 * it is meant literally: `initIntelligenceCore` on a temp directory, the real
 * SQLite ledger, the real `draftFromWpEvent` producer behind `core.tap`, the
 * real entity service, the real folds. Nothing here re-implements a producer —
 * a fixture that hand-writes the rows a producer would have written proves the
 * assertions, not the system (TESTING_STRATEGY layer 2).
 *
 * The fleet is the union of what B-03 and E-01 ask for, because their fixtures
 * are shared by design (E-01's notes: "one fixture, two evals"):
 *
 *   - 6 sites, all WooCommerce, at an updatable patch/minor delta
 *   - 2 of them share payment gateway X; one of those two is history-flagged
 *   - 1 site halted (present in the fleet, no live plugin observation)
 *
 * ONE PART OF THE FIXTURE CANNOT BE BUILT BY A PRODUCER, and that is a finding
 * rather than an inconvenience: E-01 requires prior-incident history in the
 * ledger, and NO production producer emits any `episodic.*` event — the only
 * topics any code in `src/` emits are `state.*`, `semantic.content.changed`
 * and `task.context.assembled` (chatAssembly's manifest). The incident events
 * below are therefore emitted directly through the real `Emitter` — the legal
 * entry point, with real validation and real ids — and are labelled
 * `source.system = 'fixture:e01-incident'` so nothing can mistake them for
 * something the system produced on its own. Every criterion that depends on
 * them reports the missing producer in its evidence.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../../src/main/intelligence-host/bootstrap';
import { environmentEntityId, siteEntityId } from '../../src/main/intelligence-host/provisionalEntity';

/** WooCommerce at an updatable patch/minor delta — the B-03 premise. */
export const WOO_INSTALLED = '9.4.1';
export const WOO_AVAILABLE_MINOR = '9.5.0';

export interface FixtureSite {
  /** Local site id — the value every entity id derives from. */
  siteId: string;
  name: string;
  /** B-03 skips halted sites and must say so; halted sites emit no live observation. */
  halted: boolean;
  /** E-01's blast pattern: the two sites sharing payment gateway X. */
  gatewayX: boolean;
  /** E-01/B-03's shared flag: a prior WooCommerce update broke checkout here. */
  historyFlagged: boolean;
}

export const FIXTURE_FLEET: FixtureSite[] = [
  { siteId: 'evalfleet-alpha', name: 'Alpha Staging', halted: false, gatewayX: false, historyFlagged: false },
  { siteId: 'evalfleet-bravo', name: 'Bravo Staging', halted: false, gatewayX: true, historyFlagged: true },
  { siteId: 'evalfleet-charlie', name: 'Charlie Staging', halted: false, gatewayX: true, historyFlagged: false },
  { siteId: 'evalfleet-delta', name: 'Delta Staging', halted: false, gatewayX: false, historyFlagged: false },
  { siteId: 'evalfleet-echo', name: 'Echo Staging', halted: false, gatewayX: false, historyFlagged: false },
  { siteId: 'evalfleet-foxtrot', name: 'Foxtrot Staging', halted: true, gatewayX: false, historyFlagged: false },
];

/** Topic the E-01 incident history is planted under. No producer emits it — see the header. */
export const INCIDENT_TOPIC = 'episodic.incident.recorded';
export const INCIDENT_SCHEMA = 'incident.recorded/1';
export const INCIDENT_SOURCE_SYSTEM = 'fixture:e01-incident';

export interface EvalFixture {
  core: IntelligenceCore;
  dir: string;
  fleet: FixtureSite[];
  /** Local site id → environment entity id, via the real derivation helper. */
  environmentIdOf(siteId: string): string;
  siteIdOf(siteId: string): string;
  /**
   * Topic families the fixture had to plant by hand because no producer emits
   * them. Surfaced in evidence so a green criterion can never rest silently on
   * synthetic data.
   */
  syntheticTopics: string[];
  reset(): void;
}

interface MemoryStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

function memoryStorage(): MemoryStorage {
  const map = new Map<string, unknown>();
  return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * How long to wait for the real fold worker to drain.
 *
 * `scheduleFolds` debounces by 500ms (bootstrap.ts FOLD_DEBOUNCE_MS), so a
 * fixture that seeds and immediately asserts sees an EMPTY twin store and an
 * empty freshness report — which would read as "the freshness plane does not
 * work" when it simply had not run yet. Waiting on the real debounce is the
 * honest option: reaching in to call the fold synchronously would be testing a
 * path production never takes.
 */
const FOLD_SETTLE_MS = 750;

export interface FixtureOptions {
  /**
   * E-01's abstain half (WP-13c follow-up, pre-approved). The SAME fleet with
   * no planted history: "identical prompt with an EMPTY history … score the
   * pair together". Default true — every existing caller wants the history.
   *
   * It gates the history alone, deliberately. The seeding of the fleet is
   * shared code below, so the two worlds cannot disagree about which sites
   * exist, what they run, or that the halted one reports nothing — which is
   * what makes the pair a fair pair. Before this option the twin lived in
   * `sittingWorld.ts` as a mirrored copy of `seedFleet`.
   */
  plantIncidents?: boolean;
}

/**
 * Build the fixture. `fixture_reset: required` in all three specs, so the
 * caller gets a fresh temp directory every time and `reset()` removes it —
 * there is no shared state between runs to leak a pass.
 */
export async function createEvalFixture(opts: FixtureOptions = {}): Promise<EvalFixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eval-'));
  const core = initIntelligenceCore({ storage: memoryStorage(), logger: silentLogger, dataDir: dir });
  if (!core) {
    // Non-fatal everywhere else; here it is the whole subject under test.
    throw new Error(`intelligence core failed to initialise in ${dir} — nothing can be evaluated`);
  }

  seedFleet(core);
  const synthetic = opts.plantIncidents === false ? [] : seedIncidentHistory(core);
  core.scheduleFolds();
  await new Promise((resolve) => setTimeout(resolve, FOLD_SETTLE_MS));

  return {
    core,
    dir,
    fleet: FIXTURE_FLEET,
    environmentIdOf: (siteId) => environmentEntityId(core.entities, siteId),
    siteIdOf: (siteId) => siteEntityId(core.entities, siteId),
    syntheticTopics: synthetic,
    reset() {
      try {
        core.close();
      } catch {
        /* closing a already-closed ledger must not fail a run */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Live plugin inventory, through `core.tap` — the real webhook producer path.
 * A halted site gets no observation at all, which is the honest shape: the
 * MU-plugin webhook only fires on a running site, so "halted" in this fixture
 * looks exactly like it looks in production — an absence.
 */
function seedFleet(core: IntelligenceCore): void {
  for (const site of FIXTURE_FLEET) {
    if (site.halted) continue;
    core.tap(site.siteId, 'plugin_installed', {
      slug: 'woocommerce',
      version: WOO_INSTALLED,
      is_active: true,
    });
    if (site.gatewayX) {
      core.tap(site.siteId, 'plugin_installed', {
        slug: 'payment-gateway-x',
        version: '2.1.0',
        is_active: true,
      });
    }
  }
}

/**
 * E-01's planted history: a previous WooCommerce update that broke checkout on
 * the gateway-X sites.
 *
 * `observed_at` is backdated 30 days — the incident was true then, not now.
 * Stamping "now" on planted history is the data laundering the layer's own
 * invariants forbid, and an eval fixture is exactly where that shortcut would
 * go unnoticed.
 */
function seedIncidentHistory(core: IntelligenceCore): string[] {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let planted = 0;

  for (const site of FIXTURE_FLEET.filter((s) => s.gatewayX || s.historyFlagged)) {
    try {
      core.emitter.emit({
        observed_at: thirtyDaysAgo,
        topic: INCIDENT_TOPIC,
        schema: INCIDENT_SCHEMA,
        entity: {
          site: siteEntityId(core.entities, site.siteId),
          environment: environmentEntityId(core.entities, site.siteId),
        },
        actor: { id: 'act_eval_fixture', kind: 'system' },
        source: { class: 'work', system: INCIDENT_SOURCE_SYSTEM, trust: 'emitted' },
        payload: {
          component: 'woocommerce',
          from_version: '9.3.0',
          to_version: WOO_INSTALLED,
          impact: 'checkout returned HTTP 500 after update',
          correlate: 'payment-gateway-x',
          resolved: true,
        },
      });
      planted++;
    } catch {
      /* a fixture that cannot plant history reports zero, it does not crash */
    }
  }

  return planted > 0 ? [INCIDENT_TOPIC] : [];
}
