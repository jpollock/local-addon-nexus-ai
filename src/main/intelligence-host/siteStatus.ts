/**
 * WP-21 · "Where am I?" — the four-line site status (surface contract S3).
 *
 * > You're in a safe copy of Alpine Outfitters.
 * > Code: the campaign-acf branch.
 * > Content: pulled from the live site, 11 days ago.
 * > Nothing you do here touches the live site.
 *
 * That paragraph IS the three-layer model, rendered, and it is the only teaching
 * the surface ever does unprompted. It composes from the task frame (which copy,
 * which Site, which place it follows) and WP-15's comparator (how old the content
 * is), which is why this is the frame's first consumer rather than a fifth reader
 * of the graph.
 *
 * Controlled Vocabulary v1 governs every string here, and this file is where it
 * is easiest to break, because the model's own words are the forbidden ones:
 *
 *   - "your copy", never working copy / sandbox / environment;
 *   - "the live site", never production (that word belongs to the Access &
 *     Permissions settings surface, where it is already established);
 *   - **"development (at WP Engine)" on every reference**, never bare
 *     "development" — docs finding №6: users call their own copy "dev" too, and a
 *     status line is precisely where that ambiguity would do damage. This module
 *     holds no session state, so "on first reference in a session" is satisfied
 *     the only honest way available: always;
 *   - the content age is TIME (finding №3's per-flow units) and the code line is
 *     a branch name — never the reverse.
 *
 * Two absences stay distinct, deliberately, and a third is added: no connection
 * on record, a connection with no recorded sync, and more than one place it could
 * have come from. Each has a different remedy; collapsing any pair of them throws
 * away the only thing the reader could act on.
 *
 * **The code line is omitted, not faked.** Nothing in this codebase records a
 * branch yet (`code_ref` is the model's §3 payload addition, still unproduced).
 * An honest omission beats "Code: unknown" on every site forever; when a producer
 * starts stamping `code_ref`, the line appears with no change here.
 *
 * READ-ONLY, and non-fatal: every path returns lines, and a broken core costs
 * detail rather than an answer.
 */
import { divergence } from '../../intelligence';
import { buildTaskFrame, DescribeEnvironment, EnvironmentKind } from './taskFrame';
import { provisionalEnvironmentId } from './provisionalEntity';
import type { IntelligenceCore } from './bootstrap';

export interface SiteStatusRequest {
  core: IntelligenceCore;
  /** The Local site id of the copy the user is standing in. */
  localSiteId: string;
  /** The site's name as Local shows it — what the user already calls it. */
  siteName: string;
  describeEnvironment?: DescribeEnvironment;
  now?: Date;
}

export type ContentState = 'pulled' | 'no-sync' | 'ambiguous' | 'unlinked';

/** The rendering input — every branch of the status, as facts. */
export interface SiteStatusModel {
  siteName: string;
  /** True when anything on record connects this copy to a place it can reach. */
  linked: boolean;
  /** The branch, when one is on record. Absent is the normal case today. */
  branch?: string;
  content: {
    state: ContentState;
    /** The source in the user's words, already translated. */
    sourceName?: string;
    behindSeconds?: number;
    candidateCount?: number;
  };
}

export interface SiteStatus {
  /** The rendered answer, one sentence per line. */
  lines: string[];
  model: SiteStatusModel;
  /** The copy's entity id — for a caller that wants to go deeper (never rendered). */
  copyEntityId: string;
}

/**
 * How far back to look for a recorded branch. Bounded because this is a status
 * line, not an archaeology tool: a copy with no `code_ref` in its last 200
 * observations does not have one, and reading its whole history to prove that
 * would cost a chat turn real time.
 */
const CODE_REF_WINDOW = 200;

export function siteStatus(req: SiteStatusRequest): SiteStatus {
  const now = req.now ?? new Date();
  // Pure derivation: a status read must never register an entity (ADR-21's id
  // freeze; audit A7 is what happens when a read path calls ensure()).
  const copyEntityId = provisionalEnvironmentId(req.localSiteId);

  const { tracks, ambiguous, candidateCount } = safely(() =>
    buildTaskFrame({
      core: req.core,
      copyEntityId,
      label: req.siteName,
      describeEnvironment: req.describeEnvironment,
    })
  ) ?? { tracks: undefined, ambiguous: false, candidateCount: 0 };

  const report = safely(() =>
    divergence(copyEntityId, {
      ledger: req.core.ledger,
      twins: req.core.twins,
      entities: req.core.entities,
      now,
    })
  );

  const sourceName = tracks ? placeName(tracks) : undefined;
  const branch = codeBranch(req.core, copyEntityId);
  const model: SiteStatusModel = {
    siteName: req.siteName,
    linked: !!tracks || candidateCount > 0,
    ...(branch ? { branch } : {}),
    content: contentOf(report?.content, { sourceName, ambiguous, candidateCount }),
  };

  return { lines: renderSiteStatus(model), model, copyEntityId };
}

function contentOf(
  content: { behindSeconds?: number; pulledAt?: string } | undefined,
  ctx: { sourceName?: string; ambiguous: boolean; candidateCount: number }
): SiteStatusModel['content'] {
  if (content?.pulledAt && content.behindSeconds !== undefined && ctx.sourceName) {
    return { state: 'pulled', sourceName: ctx.sourceName, behindSeconds: content.behindSeconds };
  }
  if (ctx.sourceName) return { state: 'no-sync', sourceName: ctx.sourceName };
  // More than one candidate and nothing choosing between them is not the same
  // answer as nothing on record at all: one of them has a settleable question.
  if (ctx.ambiguous || ctx.candidateCount > 1) {
    return { state: 'ambiguous', candidateCount: ctx.candidateCount };
  }
  return { state: 'unlinked' };
}

// ---------------------------------------------------------------------------
// Rendering — Controlled Vocabulary v1
// ---------------------------------------------------------------------------

export function renderSiteStatus(model: SiteStatusModel): string[] {
  const lines = [`You're in a safe copy of ${model.siteName}.`];
  if (model.branch) lines.push(`Code: the ${model.branch} branch.`);
  lines.push(contentLine(model.content));
  lines.push(
    model.linked
      ? 'Nothing you do here touches the live site.'
      : // With nothing on record to reach, the guarantee is stronger and saying
        // "the live site" would imply one is connected. Both sentences are true;
        // only one of them is true about THIS copy.
        'Nothing you do here touches anything outside this computer.'
  );
  return lines;
}

function contentLine(content: SiteStatusModel['content']): string {
  if (content.state === 'pulled') {
    return `Content: pulled from ${content.sourceName}, ${durationPhrase(content.behindSeconds ?? 0)} ago.`;
  }
  if (content.state === 'no-sync') {
    return (
      `Content: no recorded sync with ${content.sourceName}, so how old this copy's ` +
      `content is isn't known.`
    );
  }
  if (content.state === 'ambiguous') {
    return (
      `Content: this site has ${content.candidateCount} places this copy could have taken ` +
      `content from, and nothing on record says which — so how old this copy's content ` +
      `is isn't known.`
    );
  }
  return `Content: nothing on record says where this copy's content came from.`;
}

/**
 * A plain-English duration. Long form ("11 days"), not the fleet tools' compact
 * "11d", because this sentence is read aloud by the model in a reply — the two
 * surfaces render the same fact for different readers.
 *
 * Exported for WP-22b: the docked panel's content-age chip renders the same age in
 * the same words, and the renderer bundle cannot import this one. Its copy lives in
 * `renderer/components/DockedPanel/siteContextModel.ts` and the two are pinned
 * together by a shared case table in `tests/unit/renderer/contentAgePhrase.test.ts`
 * — the same duplicated-rule discipline as `localDay` and `resolveAgentCron`.
 */
export function durationPhrase(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 3600) return 'less than an hour';
  if (seconds < 86_400) return plural(Math.round(seconds / 3600), 'hour');
  return plural(Math.round(seconds / 86_400), 'day');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The place a copy follows, in the words the vocabulary allows.
 *
 * `kind` beats `name` deliberately: "the live site" is what a user calls their
 * production install, and printing `alpine-prod` instead would make them map an
 * install name onto a concept the surface has already named for them. A place
 * with no kind on record falls back to its name, and then to a phrase that names
 * the relationship without claiming to know the place.
 */
function placeName(place: { name?: string; kind?: EnvironmentKind; host?: 'wpe' | 'external' }): string {
  if (place.kind === 'production') return 'the live site';
  if (place.kind === 'staging') return place.host === 'wpe' ? 'staging' : (place.name ?? 'staging');
  if (place.kind === 'development') {
    // Finding №6, always: never bare "development".
    return place.host === 'wpe' ? 'development (at WP Engine)' : (place.name ?? 'development');
  }
  return place.name ?? 'the site it follows';
}

// ---------------------------------------------------------------------------
// The branch, when something recorded one
// ---------------------------------------------------------------------------

/**
 * The newest recorded `code_ref.branch` for this copy (model §3: git-backed
 * environments carry branch + sha on their state observations, as provenance).
 *
 * Newest by `observed_at`, not by arrival: the ledger orders by ULID, and a
 * backfilled observation can arrive after a newer live one. A payload with a sha
 * and no branch says nothing about a branch and is skipped rather than guessed
 * from.
 */
function codeBranch(core: IntelligenceCore, copyEntityId: string): string | undefined {
  const events =
    safely(() =>
      core.ledger.query({ entityId: copyEntityId, order: 'desc', limit: CODE_REF_WINDOW })
    ) ?? [];

  let best: { at: string; branch: string } | undefined;
  for (const e of events) {
    const ref = (e.payload as { code_ref?: unknown } | undefined)?.code_ref as
      | { branch?: unknown }
      | undefined;
    const branch = ref && typeof ref.branch === 'string' && ref.branch ? ref.branch : undefined;
    if (!branch) continue;
    if (!best || e.observed_at > best.at) best = { at: e.observed_at, branch };
  }
  return best?.branch;
}

/** A status line is a diagnostic: one broken input costs its own detail only. */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
