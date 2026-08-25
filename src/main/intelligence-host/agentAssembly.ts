/**
 * WP-59 · The host side of the context assembler, bound to an AGENT RUN.
 *
 * The sibling of `chatAssembly.ts`, and deliberately a sibling rather than a
 * fork: both call the same `assemble()`. Two callers of one assembler is the
 * design (ADR-10 — the assembler is stateless and surface-agnostic); a second
 * assembler would be the drift this layer exists to prevent.
 *
 * WHAT IT CLOSES. Measured at WP-59's announce: **36 `task.context.assembled`
 * manifests exist and all 36 are the chat assembler's. Zero are from an
 * agent.** So "what did the agent know when it acted" — the question §6.4 of
 * the architecture doc says the manifest answers — has no stored answer for
 * the actors that act unattended. That is the design note's §1.1 argument in
 * one number.
 *
 * ── Three decisions this module makes, and why they are not rulings ─────────
 *
 * **The intent is the agent's own manifest description.** Chat passes the
 * user's message; an agent has no utterance. The description is authored,
 * reviewed, and is the agent's own statement of what it does — the closest
 * true thing to an intent. Absent, a plain `"<trigger> run of <agent>"` is
 * derived rather than left blank: this lands in the manifest, and a blank
 * intent there is a stored record that says nothing about why the run happened.
 *
 * **Empty targets are first-class, not an error.** An agent with
 * `siteScoped: false` has none. Measured against the assembler rather than
 * assumed: it carries `targets: []` internally, and its episodic retrieval
 * returns `[]` for a zero-target request rather than throwing. The consequence
 * is simply no episodic priors — correct, because there is nothing to have
 * priors about.
 *
 * **The bundle's PROSE does not reach the agent's model, and that is the
 * point of shipping this now.** The assembler renders a turn block for a chat
 * model; an agent hand-rolls its prompt in `AgentAIClient`. Feeding the ambient
 * block into every agent's prompt is a real behaviour change with real cost,
 * and it deserves evidence. So this packet is ADDITIVE: bundle and manifest
 * only, **zero change to any agent's model call**. That is WP-20b's pattern,
 * which WP-20f then flipped by ruling once there was something to rule on.
 *
 * ── Non-fatal, and the distinction that matters (R3, §6.1) ──────────────────
 *
 * A **fault degrades**: a throwing assembler, an absent core, an unreadable
 * store — the run proceeds exactly as it does today and the bundle is
 * `undefined`. A **refusal binds** — a missing policy set or a hash mismatch
 * dropping the run to read-only diagnostics — and that is NOT built here; it
 * is the next slice. Collapsing the two would turn fail-closed into
 * fail-open-on-exception, so they are kept apart from the first line of code.
 */
import { assemble } from '../../intelligence';
import type { BundleManifest, ContextBundle, EntityRef } from '../../intelligence';
import type { AgentDefinition } from '../agent-sdk/types';
import { resolveSite } from '../mcp/site-resolver';
import type { NexusServices } from '../mcp/types';
import { getIntelligenceCore } from './coreRegistry';
import { environmentEntityId, siteEntityId } from './provisionalEntity';

/** `surface` — so a manifest says which actor class produced it. */
export const AGENT_SURFACE = 'agent.runtime';

/**
 * The manifest topic — the SAME one chat writes, deliberately.
 *
 * A separate topic per surface would be the `total`-shaped collision ruled at
 * WP-48/50/52 read backwards: one question ("what context did this actor
 * have") split across two words, so every reader has to know both. `actor` and
 * `surface` already distinguish them, and they are the fields a reader would
 * filter on anyway.
 */
export const CONTEXT_ASSEMBLED_TOPIC = 'task.context.assembled';
export const CONTEXT_ASSEMBLED_SCHEMA = 'context.assembled/1';

/** `source.system` — one value, so liveness is one row in the health table. */
export const AGENT_ASSEMBLER_SYSTEM = 'assembler:agent';

/**
 * The entities this run assembled context ABOUT.
 *
 * The run's site at the runner level is exactly the triggering event's — an
 * agent's own `scope.siteIds` is read by the agent, per tool call, not by the
 * runner, so it is not a fact the run frame knows. A cron run therefore has no
 * target, and that is the common case rather than a degraded one.
 *
 * **Nothing is invented when the id does not resolve.** The event's site id is
 * Local's, so a WPE install id or a stale id lands here and finds nothing;
 * minting an entity for a site we cannot name would put a fabricated target in
 * the one record whose job is saying what was really in scope. Empty is the
 * honest answer and the assembler treats it as first-class.
 */
export function agentRunTargets(
  services: Pick<NexusServices, 'siteData'> | undefined,
  siteId: string | undefined
): EntityRef[] {
  if (!siteId || !services?.siteData) return [];
  try {
    const site = resolveSite(siteId, services.siteData);
    if (!site) return [];
    const core = getIntelligenceCore();
    // Both, as chat does: the running copy and the logical site are different
    // entities, and a fact about one is not automatically a fact about the
    // other.
    return [
      { role: 'environment', id: environmentEntityId(core?.entities, site.id), label: site.name },
      { role: 'site', id: siteEntityId(core?.entities, site.id), label: site.name },
    ];
  } catch {
    return [];
  }
}

/**
 * What this run is FOR, in the manifest's own field.
 *
 * The agent's reviewed description when it has one; a derived sentence when it
 * does not. Never empty — see the module header.
 */
export function agentRunIntent(agent: AgentDefinition, trigger: string): string {
  const described = typeof agent.description === 'string' ? agent.description.trim() : '';
  return described || `${trigger} run of ${agent.name}`;
}

/**
 * What binds this run, when the assembler refused it.
 *
 * **The other half of R3, and the one the module header said was not built
 * yet.** A fault degrades — the bundle is `undefined` and the run is exactly
 * what it was before this packet. A REFUSAL binds: `assemble()` returns a
 * `failClosed` bundle when an autonomous actor has no policy set (ADR-7), or
 * when its granted procedure will not load or does not hash to the document it
 * was granted against. The bundle's own words are "take no action that changes
 * any site, run read-only diagnostics only".
 *
 * Those words are prose in a turn block, and **an agent's prose is advice a
 * prompt-injected model can ignore.** So they are enforced, in
 * `NexusToolProvider`, against tier — not asked for. This function is only the
 * derivation of the SHORT cause; it exists here rather than in the tool
 * provider so the provider needs no opinion about bundles, and returns
 * `undefined` for the overwhelmingly common case of a bundle that assembled
 * normally or an assembly that never happened.
 *
 * Absence is deliberately NOT a refusal: no bundle means no core, no frame, or
 * a fault, and binding on those would make an intelligence-layer outage stop
 * every agent in the fleet from working — fail-open-on-exception's mirror
 * image, and just as wrong.
 */
export function refusalBind(bundle: ContextBundle | undefined): { reason: string } | undefined {
  if (!bundle?.failClosed) return undefined;
  const procedure = bundle.procedure;
  if (procedure && procedure.status === 'refused') {
    return {
      reason:
        `the procedure for ${procedure.capability} was not delivered ` +
        `(${procedure.code})`,
    };
  }
  return { reason: 'no operating policy set could be loaded for this autonomous run' };
}

export interface AgentAssemblyRequest {
  agent: AgentDefinition;
  /**
   * The run's frame — the actor, the task id, and the deferral the manifest
   * rides on all come from here.
   */
  frame: {
    id: string;
    actor: { id: string; kind: 'agent' };
    autonomy: 'interactive' | 'autonomous';
    onFlush(fn: () => void): void;
  };
  trigger: string;
  /** The triggering event's site, when the run had one. */
  siteId?: string;
  /** For resolving that site. Absent on a run with no site to resolve. */
  services?: Pick<NexusServices, 'siteData'>;
  /** Test seam. Production uses the core's own `assemble`. */
  assembleFn?: typeof assemble;
}

/**
 * Record what this run was given, once the run turns out to be real.
 *
 * Mirrors `chatAssembly`'s `emitManifest` and differs in exactly two fields,
 * both load-bearing: the actor is the **agent** (never `act_chat_assembler`,
 * never `kind: 'system'` — attributing an agent's manifest to chat would leave
 * "what did the agent know" unanswered while looking answered), and
 * `source.system` names this producer so liveness is separable.
 *
 * The whole body is guarded. A lost manifest must not cost the run, and this
 * is invoked from inside the frame's flush, where a throw would also cost the
 * bracket.
 */
function emitAgentManifest(
  core: NonNullable<ReturnType<typeof getIntelligenceCore>>,
  manifest: BundleManifest,
  targets: EntityRef[],
  actor: { id: string; kind: 'agent' }
): void {
  try {
    const entity: Record<string, string> = {};
    for (const t of targets) entity[t.role] = t.id;
    core.emitter.emit({
      // The ASSEMBLY's own moment, carried out of the manifest. Never "now":
      // this runs at flush time, which can be the whole length of the run
      // later, and a bracket stamped at write time is the data laundering the
      // layer's `observed_at` invariant forbids.
      observed_at: manifest.assembled_at,
      topic: CONTEXT_ASSEMBLED_TOPIC,
      schema: CONTEXT_ASSEMBLED_SCHEMA,
      entity,
      actor,
      source: { class: 'work', system: AGENT_ASSEMBLER_SYSTEM, trust: 'emitted' },
      correlation: manifest.task,
      payload: manifest as unknown as Record<string, unknown>,
    } as never);
    core.scheduleFolds?.();
  } catch {
    /* a lost manifest must not cost the run, nor the bracket it rides on */
  }
}

/**
 * Assemble a context bundle for one agent run. Never throws.
 *
 * Returns `undefined` when the layer could not assemble — an unassembled run
 * is honest, and every caller treats the bundle as optional exactly as it
 * treats the frame.
 */
export async function assembleForAgentRun(
  req: AgentAssemblyRequest
): Promise<ContextBundle | undefined> {
  try {
    const core = getIntelligenceCore();
    if (!core) return undefined;

    const run = req.assembleFn ?? assemble;
    const targets = agentRunTargets(req.services, req.siteId);

    const bundle = await run(
      {
        // The actor is the RUN's, not a surface constant. `autonomy` is
        // ADR-7's input and it was derived from the trigger by the frame —
        // reading it from anywhere else would decide a safety rule by
        // accident.
        actor: {
          id: req.frame.actor.id,
          kind: req.frame.actor.kind,
          autonomy: req.frame.autonomy,
        },
        // v0: an agent run holds no capability grant. Phase 3 changes this,
        // and the procedure plane stays dark until it does.
        capability: null,
        task: { id: req.frame.id, intent: agentRunIntent(req.agent, req.trigger) },
        targets,
        surface: AGENT_SURFACE,
      } as never,
      {
        law: core.law?.registry,
        runbooks: core.law?.runbooks,
        ledger: core.ledger,
        twins: core.twins,
        // `semantic` and `wrapUntrusted` are deliberately ABSENT. The
        // assembler skips retrieval entirely without `wrapUntrusted` — its own
        // comment calls shipping attacker-authorable text into a trusted
        // channel "the one failure this assembler must not have" — and until
        // the prose actually reaches a model there is nothing for retrieval to
        // ride on. Wiring it before then would add the risk without the value.
      } as never
    );

    // DEFERRED, and the reason is arithmetic. Assembly itself is reads only —
    // it costs nothing to do on every run. Its RECORD is a ledger write, and
    // one per run is the 1,440 events a day WP-57's lazy frame was bought to
    // avoid, from the same two-minute diagnostic agent. So the manifest rides
    // the frame's own realness test: it lands for runs that mattered, after
    // the assignment it correlates to, and not at all for a quiet run.
    const manifest: BundleManifest | undefined = bundle?.manifest;
    if (manifest) {
      req.frame.onFlush(() => emitAgentManifest(core, manifest, targets, req.frame.actor));
    }

    return bundle;
  } catch {
    // A fault costs the bundle, never the run.
    return undefined;
  }
}
