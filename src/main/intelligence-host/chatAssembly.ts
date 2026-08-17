/**
 * WP-11 · The host side of the context assembler, bound to the chat surface.
 *
 * ADR-19's anchor actor is the Docked Panel chat. This module is the only new
 * file in `src/main/` for that wiring: it builds the AssembleRequest from what
 * `ChatService` has, hands the core its host ports, emits the manifest as a
 * ledger event, and returns two rendered strings plus the turn's TaskId.
 *
 * Everything a chat turn needs to know about the intelligence layer lives
 * here, so `ChatService` gains three call sites and no logic — the same ruling
 * WP-04 made about inlining logic into a locked handler.
 *
 * NON-FATAL BY CONSTRUCTION. Every path returns `null` rather than throwing:
 * an intelligence-layer fault must never break a chat turn. `null` means "the
 * assembler contributed nothing", and the caller's behaviour is then
 * byte-identical to the pre-WP-11 build (the additive-parity pin).
 */
import {
  assemble,
  taskId as mintTaskId,
  AssembleRequest,
  ContextBundle,
  EntityRef,
  SemanticHit,
} from '../../intelligence';
import { getIntelligenceCore } from './coreRegistry';
import { environmentEntityId, siteEntityId } from './provisionalEntity';
import { wrapUntrusted } from '../mcp/pii';
import { resolveSite } from '../mcp/site-resolver';
import type { NexusServices } from '../mcp/types';

/** ADR-19 refinement: the anchor surface is the Docked Panel specifically. */
const CHAT_SURFACE = 'chat.docked-panel';

/** The manifest's topic + payload schema (architecture doc §4.2, §6.4). */
export const CONTEXT_ASSEMBLED_TOPIC = 'task.context.assembled';
export const CONTEXT_ASSEMBLED_SCHEMA = 'context.assembled/1';

const SEMANTIC_LIMIT = 5;

export interface ChatAssemblyRequest {
  services: NexusServices;
  sessionId: string;
  userMessage: string;
  siteId?: string;
  /**
   * True when this turn (re)builds the system prompt — the full policy set
   * rides there, so the per-turn carrier re-asserts by hash alone (ADR-20).
   */
  buildingSystemPrompt: boolean;
}

export interface ChatAssemblyResult {
  /** ULID TaskId, threaded as `correlation` on every event this turn produces. */
  taskId: string;
  /** For the system prompt. Null when there is no policy set to assert. */
  ambientBlock: string | null;
  /** Per-turn carrier. Null when the assembler has nothing to say this turn. */
  turnBlock: string | null;
  /**
   * Scoped tool grants for `adaptToolsForChat`.
   *
   * ALWAYS `undefined` in v0, and the mapping is load-bearing: the assembler
   * returns `tools: []`, and an empty array must NEVER reach the tool adapter
   * as a filter. `[]` means deny-all in the one existing scoping surface in
   * this codebase (`agent.tools`, buildAgentContext.ts) — passing it through
   * would silently strip every tool from the chat model.
   */
  grants: string[] | undefined;
}

/**
 * Which policy version each session has already been shown.
 *
 * Host state, not assembler state: the assembler is stateless by ADR-10, so
 * "what does this actor already carry" has to be remembered on this side. A
 * process restart empties the map, which is the correct failure direction —
 * the next turn re-asserts the full set rather than assuming it is present.
 */
const sessionPolicyHash = new Map<string, string>();

/** Drop a session's remembered policy assertion (chat clear / session delete). */
export function forgetChatAssemblySession(sessionId: string): void {
  sessionPolicyHash.delete(sessionId);
}

export async function assembleForChatTurn(
  req: ChatAssemblyRequest
): Promise<ChatAssemblyResult | null> {
  try {
    const core = getIntelligenceCore();
    if (!core) return null; // core optional by contract — degrade silently

    const taskId = mintTaskId();
    const targets = resolveTargets(req);

    // WP-08's tripwire, run at assembly time so a mirror that has drifted from
    // the live settings is disclosed on the turn it matters, not at startup.
    let policyDivergences = 0;
    try {
      policyDivergences = core.law?.verifyMirror().length ?? 0;
    } catch {
      /* the tripwire must never break the turn it guards */
    }

    const request: AssembleRequest = {
      actor: { id: 'act_chat_assembler', kind: 'system', autonomy: 'interactive' },
      capability: null, // v0 chat runs under no capability grant
      task: { id: taskId, intent: req.userMessage },
      targets,
      surface: CHAT_SURFACE,
      policyDivergences,
      context: {
        policyVersionHash: sessionPolicyHash.get(req.sessionId),
        rebuildingDurableContext: req.buildingSystemPrompt,
      },
      retrieval: { semanticLimit: SEMANTIC_LIMIT },
    };

    const bundle = await assemble(request, {
      law: core.law?.registry,
      ledger: core.ledger,
      twins: core.twins,
      semantic: semanticPortFor(req.services),
      wrapUntrusted,
    });

    if (bundle.ambient) sessionPolicyHash.set(req.sessionId, bundle.ambient.versionHash);

    emitManifest(core, bundle, targets);

    return {
      taskId,
      ambientBlock: bundle.blocks.ambient,
      turnBlock: bundle.blocks.turn,
      // See ChatAssemblyResult.grants — [] must never become a filter.
      grants: bundle.tools.length > 0 ? bundle.tools.map((t) => t.name) : undefined,
    };
  } catch {
    return null; // swallow everything: a chat turn is never broken by this layer
  }
}

/**
 * The chat turn's targets. A Local site id resolves to its environment entity
 * through the same derivation every producer uses, so the assembler's episodic
 * and freshness queries key on ids the ledger already holds.
 *
 * WP-16 (audit A3): the logical Site rides alongside the environment. Every
 * producer dual-stamps `site` and `Ledger.query`'s entity filter matches ANY
 * role, so with the environment alone the episodic slice was scoped to this one
 * copy — prior activity on another environment of the same Site was invisible
 * to a turn that is plainly about that Site. Additive: the assembler is
 * unchanged, twin facts key to the environment so freshness is untouched, and
 * the extra role makes the manifest's entity block honest about what was
 * retrieved. Per-plane routing (freshness→copy, episodic→Site) is M3's frame.
 */
function resolveTargets(req: ChatAssemblyRequest): EntityRef[] {
  if (!req.siteId) return [];
  try {
    const site = resolveSite(req.siteId, req.services.siteData);
    if (!site) return [];
    const core = getIntelligenceCore();
    return [
      {
        role: 'environment',
        id: environmentEntityId(core?.entities, site.id),
        label: site.name,
      },
      {
        role: 'site',
        id: siteEntityId(core?.entities, site.id),
        label: site.name,
      },
    ];
  } catch {
    return [];
  }
}

/** Bridges the existing fleet search service onto the core's SemanticPort. */
function semanticPortFor(services: NexusServices) {
  const search = (services as { searchService?: unknown }).searchService as
    | {
        searchFleet: (
          query: string,
          filters?: unknown,
          options?: unknown
        ) => Promise<{ results?: Array<Record<string, unknown>> }>;
      }
    | undefined;
  if (!search?.searchFleet) return undefined;

  return {
    async search(query: string, _entityIds: string[], limit: number): Promise<SemanticHit[]> {
      // Scoping note: the search service filters by LOCAL site id, and the
      // assembler speaks entity ids. v0 therefore searches fleet-wide and
      // labels each hit with its site, exactly as surface B does today
      // (ipc-handlers.ts:2878). Per-entity scoping is B-04's job and needs the
      // entity→siteId reverse lookup that WP-07 has not exposed yet.
      const res = await search.searchFleet(query, undefined, { limit });
      return (res?.results ?? []).slice(0, limit).map((r, i) => ({
        id: String(r.id ?? `${r.siteId ?? 'result'}:${i}`),
        title: String(r.title ?? 'untitled'),
        ...(typeof r.excerpt === 'string' ? { excerpt: truncate(r.excerpt, 200) } : {}),
        ...(typeof r.siteName === 'string' ? { label: r.siteName } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
      }));
    },
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * The manifest IS an event, so it goes to the LEDGER — not to
 * `operation-audit.log`. This codebase has three audit sinks with documented
 * drift (CLAUDE.md "Three sinks, not one") and the pull toward the audit file
 * is strong; recon §4.4 pin 2 exists to settle it. `correlation` is the turn's
 * TaskId, which makes "what did the agent know when it acted" a
 * `WHERE correlation = ?` query joining this manifest to every other event the
 * turn produces.
 *
 * First `task.*` producer in the codebase.
 */
function emitManifest(
  core: NonNullable<ReturnType<typeof getIntelligenceCore>>,
  bundle: ContextBundle,
  targets: EntityRef[]
): void {
  try {
    const entity: Record<string, string> = {};
    for (const t of targets) entity[t.role] = t.id;

    core.emitter.emit({
      // Assembly is observed live: the manifest is true at the moment it is
      // built, so "now" is the honest observed_at (cp.observed-at).
      observed_at: bundle.manifest.assembled_at,
      topic: CONTEXT_ASSEMBLED_TOPIC,
      schema: CONTEXT_ASSEMBLED_SCHEMA,
      entity,
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
      correlation: bundle.manifest.task,
      payload: bundle.manifest as unknown as Record<string, unknown>,
    });
    core.scheduleFolds();
  } catch {
    /* a lost manifest must not cost the user their turn */
  }
}
