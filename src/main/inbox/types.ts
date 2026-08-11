/** Which of the Inbox's three groups an item belongs to. */
export type InboxKind = 'decide' | 'problem' | 'know';

/** `open` is actionable; `dismissed` and `done` are decided and stay decided. */
export type InboxStatus = 'open' | 'dismissed' | 'done';

export interface InboxItemInput {
  /** The agent that raised it, e.g. 'security-sentinel'. */
  source: string;
  /**
   * Check code (`'FS-01'`) or, for a failure, `failureCode(message)`.
   * NOT a per-instance id — two sites failing one check share a code.
   */
  code: string;
  /**
   * Stable target identity, namespaced: `local:<siteId>`, `name:<siteName>`,
   * or `*` for fleet-level. Never a bare display name — names collide across
   * sources (see CLAUDE.md "Names collide across sources").
   */
  scope: string;
  /** What to show for the scope: 'Good Aesthetic Club', '12 sites'. */
  scopeLabel: string;
  kind: InboxKind;
  title: string;
  detail?: string;
  /** Shown behind a disclosure. */
  evidence?: string;
  severity?: string;
  /** Arbitrary structured extra (plan, raw finding). Stored as JSON. */
  payload?: unknown;
}

export interface InboxItem {
  id: number;
  source: string;
  code: string;
  scope: string;
  scopeLabel: string;
  kind: InboxKind;
  title: string;
  detail?: string;
  evidence?: string;
  severity?: string;
  status: InboxStatus;
  decision?: string;
  decidedAt?: number;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  payload?: unknown;
}
