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
import type { AgentDefinition } from '../agent-sdk/types';
import { getIntelligenceCore } from './coreRegistry';

/** `surface` — so a manifest says which actor class produced it. */
export const AGENT_SURFACE = 'agent.runtime';

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

export interface AgentAssemblyRequest {
  agent: AgentDefinition;
  /** The run's frame — the actor and the task id both come from here. */
  frame: {
    id: string;
    actor: { id: string; kind: 'agent' };
    autonomy: 'interactive' | 'autonomous';
  };
  trigger: string;
  /** Resolved entities. Empty when the agent is not site-scoped. */
  targets: unknown[];
  /** Test seam. Production uses the core's own `assemble`. */
  assembleFn?: typeof assemble;
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
): Promise<unknown | undefined> {
  try {
    const core = getIntelligenceCore();
    if (!core) return undefined;

    const run = req.assembleFn ?? assemble;

    return await run(
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
        targets: req.targets,
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
  } catch {
    // A fault costs the bundle, never the run.
    return undefined;
  }
}
