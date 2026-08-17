/**
 * WP-15 · Rendering the comparator, in the words users are allowed to hear.
 *
 * The computation lives in `src/intelligence/compare/divergence.ts`; this file
 * is the boundary where internal vocabulary becomes product vocabulary. It is
 * deliberately on the HOST side of the ADR-16 seam: user-facing copy is a
 * product surface, and the core stays free of it.
 *
 * Controlled Vocabulary v1
 * (`docs/intelligence/user-docs/your-copy-and-the-live-site.md`) governs every
 * string below, and its rules are unusually easy to break by accident, because
 * the forbidden words are precisely the words this subsystem is BUILT out of:
 *
 *   - **"drift" is reserved** for change reports (one thing changing over
 *     time). Copy-vs-live is **behind** / **ahead**.
 *   - **"divergence" is never said**, though it is the name of the function.
 *   - **Units are per flow** (pressure-test finding №3, binding): content in
 *     TIME, code in ITEMS. "11 days behind" and "3 items behind" both read;
 *     one line carrying both does not.
 *   - twin, ledger, entity, lineage, upstream, sandbox, SLO, stale — internal
 *     every one. An entity id in particular must never reach a rendered line.
 *
 * `DIVERGENCE_FORBIDDEN_WORDS` makes that a test rather than a convention.
 */
import { divergence } from '../../intelligence';
import type { DivergenceReport, CodeItem, SideObservation, SyncFlow } from '../../intelligence';
import type { IntelligenceCore } from './bootstrap';

/*
 * The list of words no rendered line may contain lives in the TEST
 * (`__tests__/divergenceReport.test.ts`), deliberately, and not here. A
 * forbidden-word list exported from production and imported by the test that
 * enforces it is not a gate: deleting a word from it makes the test pass. The
 * test owns its own oracle.
 */

export interface DivergenceLabels {
  /** What the user calls this copy — the local site's own name. */
  copy: string;
  /** What the user calls the site it tracks. Absent when nothing can name it. */
  upstream?: string;
}

/** The last resort when nothing names the other side. Never an id. */
const UNNAMED_UPSTREAM = 'the site it tracks';

/**
 * The appended section, as markdown lines. APPENDED, never interleaved: the
 * legacy report above it must render byte-identically with the core absent
 * (the reader-migration pattern's parity rule), which is only checkable if
 * this block starts after the last legacy line and adds nothing above it.
 */
export function renderDivergenceSection(
  report: DivergenceReport,
  labels: DivergenceLabels
): string[] {
  const other = labels.upstream ?? UNNAMED_UPSTREAM;
  const lines: string[] = [`#### ${labels.copy} — how far behind or ahead`];

  if (!report.upstream) {
    lines.push(unresolvedLine(report, labels));
    return lines;
  }

  lines.push(contentLine(report, other));
  lines.push(codeLine(report, other));
  lines.push(...codeTable(report.code.items, labels.copy, other));
  const sync = syncLine(report, other);
  if (sync) lines.push(sync);
  const checked = checkedLine(report.code.copy, report.code.upstream, labels.copy, other);
  if (checked) lines.push(checked);
  return lines;
}

/**
 * Two different unresolved situations, two different sentences — collapsing
 * them would tell a user with two linked places the same thing it tells a user
 * with none, and only one of those has an action available.
 */
function unresolvedLine(report: DivergenceReport, labels: DivergenceLabels): string {
  if (report.ambiguous) {
    return (
      `**Content and code:** this copy's site has ${report.candidates.length} places it could be ` +
      `compared against, and nothing on record says which one ${labels.copy} follows — ` +
      `how far behind or ahead it is can't be worked out until that is settled.`
    );
  }
  return (
    `**Content and code:** nothing on record says which site this copy tracks, ` +
    `so how far behind or ahead it is can't be worked out. ` +
    `Pulling from a site records the connection.`
  );
}

/** Content is an AGE. Never an item count — nothing here observes posts. */
function contentLine(report: DivergenceReport, other: string): string {
  const { content } = report;
  if (content.behindSeconds === undefined || !content.pulledAt) {
    return (
      `**Content:** no recorded sync, so how old this copy's posts, pages and ` +
      `orders are isn't known.`
    );
  }
  return (
    `**Content:** pulled from ${other} ${fmtAge(content.behindSeconds)} — ` +
    `everything published on ${other} since then is not here.`
  );
}

/** Code is a COUNT OF ITEMS. Never an age — that is the content line's job. */
function codeLine(report: DivergenceReport, other: string): string {
  const { behind, ahead, changed, comparedFacts } = report.code;
  if (behind + ahead + changed === 0) {
    return `**Code:** no differences in plugins, themes or the WordPress version (${comparedFacts} checked).`;
  }
  const parts: string[] = [];
  if (behind) parts.push(`${plural(behind, 'item')} behind`);
  if (ahead) parts.push(`${ahead} ahead`);
  if (changed) parts.push(`${changed} changed on both sides`);
  return `**Code:** ${parts.join(', ')} compared with ${other} (${comparedFacts} checked).`;
}

function codeTable(items: CodeItem[], copyLabel: string, other: string): string[] {
  if (items.length === 0) return [];
  const lines = ['', `| Item | ${copyLabel} | ${other} | |`, '|---|---|---|---|'];
  for (const item of items) {
    lines.push(
      `| ${itemLabel(item.fact)} | ${item.copy?.version ?? '—'} | ${item.upstream?.version ?? '—'} | ${directionLabel(item)} |`
    );
  }
  return lines;
}

/**
 * The fact key is internal (`plugin:acf`); the user sees the thing itself.
 * `wp.version` is the WordPress version, which is a code item because a
 * WordPress upgrade is a change to files, not to content.
 */
function itemLabel(fact: string): string {
  if (fact === 'wp.version') return 'WordPress';
  const [kind, ...rest] = fact.split(':');
  const name = rest.join(':') || fact;
  if (kind === 'plugin') return `${name} (plugin)`;
  if (kind === 'theme') return `${name} (theme)`;
  return fact;
}

function directionLabel(item: CodeItem): string {
  if (item.status === 'only_on_copy') return 'only here';
  if (item.status === 'only_on_upstream') return 'only there';
  if (item.direction === 'behind') return 'behind';
  if (item.direction === 'ahead') return 'ahead';
  return 'changed';
}

/**
 * The zero point. `flow: 'unknown'` gets the sentence the architect ruled when
 * adjudicating WP-14: stated uncertainty beats conservative silence, and "a
 * sync happened; what it included couldn't be determined" is the true one.
 */
function syncLine(report: DivergenceReport, other: string): string | undefined {
  const anchor = report.anchor;
  if (!anchor) {
    return `**Last sync:** no recorded sync between this copy and ${other}.`;
  }
  const when = fmtAge(anchor.ageSeconds);
  if (anchor.flow === 'unknown') {
    return `**Last sync:** ${when} — a sync happened; what it included couldn't be determined.`;
  }
  const verb = anchor.direction === 'up' ? 'sent to' : anchor.direction === 'down' ? 'pulled from' : 'exchanged with';
  return `**Last sync:** ${when}, ${verb} ${other} — ${flowLabel(anchor.flow)}.`;
}

function flowLabel(flow: SyncFlow): string {
  if (flow === 'full') return 'files and content';
  if (flow === 'content') return 'content only';
  if (flow === 'code') return 'files only';
  return 'contents not determined';
}

/**
 * Per-side ages, in the vocabulary's words: "checked <time> ago", and "may be
 * out of date" instead of the internal word for it. A comparison is only as
 * trustworthy as its oldest side, so an out-of-date side is named rather than
 * footnoted.
 */
function checkedLine(
  copy: SideObservation | undefined,
  upstream: SideObservation | undefined,
  copyLabel: string,
  other: string
): string | undefined {
  const parts: string[] = [];
  if (copy) parts.push(`${copyLabel} checked ${fmtAge(copy.ageSeconds)}${copy.fresh ? '' : ' ⚠'}`);
  if (upstream) {
    parts.push(`${other} checked ${fmtAge(upstream.ageSeconds)}${upstream.fresh ? '' : ' ⚠'}`);
  }
  if (parts.length === 0) return undefined;
  const outOfDate = [copy, upstream].some((s) => s && !s.fresh);
  return (
    `*${parts.join(', ')}.*` +
    (outOfDate
      ? ' *⚠ may be out of date — a live check of the marked side before acting on the differences above.*'
      : '')
  );
}

// ---------------------------------------------------------------------------
// The tool-facing assembly
// ---------------------------------------------------------------------------

/** One copy a reader wants compared, in the reader's own vocabulary. */
export interface CopyToCompare {
  /** The copy's entity id — derived PURELY (`provisionalEnvironmentId`), never ensured. */
  entityId: string;
  /** What the reader already calls this site. */
  label: string;
}

/**
 * The appended block a migrated reader adds: one section per copy, plus the
 * population disagreement.
 *
 * Returns `[]` when there is nothing to say, so a caller can append
 * unconditionally and still render byte-identically to its legacy self.
 */
export function buildDivergenceEnrichment(
  core: IntelligenceCore,
  copies: readonly CopyToCompare[],
  now?: Date
): string[] {
  const lines: string[] = [];
  const deps = { ledger: core.ledger, twins: core.twins, entities: core.entities, now };

  for (const copy of copies) {
    const report = divergence(copy.entityId, deps);
    lines.push(
      ...renderDivergenceSection(report, {
        copy: copy.label,
        // Named from what was OBSERVED about the resolved site, never from the
        // caller's own connection settings: when the two disagree, labelling
        // the comparison with the caller's name would describe the wrong site.
        upstream: nameOf(core, report.upstream?.entityId),
      })
    );
    lines.push('');
  }

  const uncovered = uncoveredCopies(core, copies);
  if (uncovered.length > 0) {
    const named = uncovered.map((e) => nameOf(core, e)).filter((n): n is string => !!n);
    lines.push(
      `> Also on record: ${plural(uncovered.length, 'other copy', 'other copies')} with a ` +
        `recorded pull that this report does not cover` +
        (named.length ? ` (${named.join(', ')})` : '') +
        `. This report lists only sites connected through Local's own settings.`
    );
  }

  return lines.length > 0 ? ['### Behind and ahead', '', ...lines] : [];
}

/**
 * Copies with a recorded pull that the caller's own population never counted —
 * the population-level disagreement, reported and never merged in. A tool that
 * quietly added them would be answering a different question than the one it
 * documents.
 */
function uncoveredCopies(core: IntelligenceCore, copies: readonly CopyToCompare[]): string[] {
  try {
    if (!core.entities) return [];
    const covered = new Set(copies.map((c) => c.entityId));
    return [
      ...new Set(
        core.entities
          .linksOfKind('content_pulled_from')
          .map((l) => l.fromEntity)
          .filter((id) => !covered.has(id))
      ),
    ];
  } catch {
    return [];
  }
}

/** A site's observed name, or nothing. An id is never a name. */
function nameOf(core: IntelligenceCore, entityId: string | undefined): string | undefined {
  if (!entityId) return undefined;
  try {
    const value = core.twins.get(entityId, 'site.core')?.value as
      | { name?: unknown }
      | undefined;
    return typeof value?.name === 'string' && value.name.length > 0 ? value.name : undefined;
  } catch {
    return undefined;
  }
}

function plural(n: number, word: string, pluralWord?: string): string {
  if (pluralWord) return `${n} ${n === 1 ? word : pluralWord}`;
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Same vocabulary as every other fleet tool's age rendering. */
function fmtAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
