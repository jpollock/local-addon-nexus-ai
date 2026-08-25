import React from 'react';
import { marked, Renderer } from 'marked';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import { ActionCard } from './ActionCard';
import { ProcedureApprovalCard } from './ProcedureApprovalCard';
import { SiteContextStrip, type SiteChoice } from './SiteContextStrip';
import { ComparatorPanel, type ComparableFact } from './ComparatorPanel';
import { ProcedureSurfaces } from './ProcedureSurfaces';
import { nexusStore } from '../../store/NexusStateManager';
import type { GovernDoorTarget } from '../../../main/intelligence-host/sequenceGuard';
import { CitationSpans } from './CitationSpans';
import {
  applyProcedureEvent,
  emptyProcedureState,
  hasProcedureSurface,
  opensContainer,
  type ProcedureStreamState,
} from './procedureModel';
import type { SiteContextMode, SiteContentStatus } from './siteContextModel';
import type { OpeningState } from './openingAsksModel';
import type { CitationTurn } from './citationModel';
import type { ChatSession, ChatMessage } from '../../../common/types';
import type { ProcedureApprovalContext } from '../../../common/chat-types';
import { NEW_CHAT_HEADLINE, NEW_CHAT_PROMISE, NEW_CHAT_PROMISE_SHORT, NEW_CHAT_FOOTNOTE, NEW_CHAT_PLACEHOLDER, NEW_CHAT_PLACEHOLDER_SHORT, NEW_CHAT_SUGGESTIONS, NEW_CHAT_DISCLOSURE } from './newChatCopy.generated';
import type { AIProvider } from '../../../common/types';

const safeRenderer = new Renderer();
// Suppress raw HTML passthrough — LLM output should never need raw HTML
(safeRenderer as any).html = () => '';

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { renderer: safeRenderer }) as string;
  return raw
    // Belt-and-suspenders: strip any event handlers and javascript: protocols
    // that might slip through via markdown link/image syntax
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/href="javascript:[^"]*"/gi, 'href="#"')
    .replace(/href='javascript:[^']*'/gi, "href='#'");
}

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  incomplete?: boolean;  // Message was interrupted; response is partial
  /**
   * WP-38 · ADR-24's supply and manifest for this reply, when the turn carried
   * them. `reply` is overwritten from `content` at render time so the streamed
   * text and the segmented text can never be two different strings.
   */
  citation?: Omit<CitationTurn, 'reply'> & { reply?: string };
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
    status: 'pending' | 'awaiting_approval' | 'running' | 'done' | 'error';
    result?: string;
    /**
     * The card text the platform composed and RECORDED as the approval's
     * rationale. Rendering something else here would make the ledger's "the
     * card the human was shown" untrue.
     */
    warning?: string;
    /**
     * WP-26 · present only when this approval is a strict runbook's approval
     * checkpoint. It arrives ON the approval event, derived by the platform —
     * nothing here computes checkpoint state, which is the rule
     * `procedureView.ts` exists to hold.
     */
    procedure?: ProcedureApprovalContext;
  }>;
}

/**
 * What the "Currently in" strip needs, handed down whole.
 *
 * The container owns all of it — the strip is a rendering of the container's site
 * context, not a second opinion about it. `selectedSiteIds` below is derived from the
 * same selection, which is what keeps the band and the outgoing `siteId` from ever
 * disagreeing: there is one source, read twice.
 */
export interface SiteContextProps {
  mode: SiteContextMode;
  siteName: string | null;
  viewedSiteName: string | null;
  sites: SiteChoice[];
  /** WP-22b · the content age for the selected copy, or null. Optional: a caller
   *  that has nothing to say about content still renders the band. */
  content?: SiteContentStatus | null;
  onPick: (siteId: string) => void;
  onClear: () => void;
}

interface Props {
  electron: any;
  sessionId: string | null;
  /**
   * Which density this mount is. 'stage' is the full-screen board (a 560px
   * centred column); 'companion' is the 380px panel, which left-aligns
   * because a 380px column has no width to centre in — centring at that size
   * reads as an error. Defaults to companion: the docked panel is the common
   * mount, and guessing 'stage' would put stage strings in a 380px field.
   */
  density?: 'stage' | 'companion';
  /** A live status line from the stream, when one is known. */
  streamingStatusLine?: string | null;
  selectedSiteIds: string[];
  siteContext: SiteContextProps;
  /**
   * WP-49 · ITEM 4 — what the panel opens ON, drawn from the queue beside it.
   *
   * `null` is the honest state and not a loading one: nothing is waiting, so
   * there is no verdict to state and no ask that could be answered from the
   * screen, and the panel opens on its own invitation as before. The container
   * holds it because the container already reads `RETURN_TRIAGE` for the rail
   * badge — one read, two consumers, no second answer to the same question.
   */
  opening?: OpeningState | null;
  visible: boolean;
  onSessionCreated: (id: string) => void;
  onSessionSaved: (session: ChatSession, messages: ChatMessage[]) => void;
  onStreamingStatusChange?: (status: string | null) => void;
}

/**
 * WP-41 · the capability a comparator selection would arm.
 *
 * Named here rather than chosen by the comparator: a surface picking which
 * procedure governs an act would be authoring the governance. The anchor
 * capability is the one the matrix's plugin rows are about, and an ungranted
 * one simply produces a scope in which nothing runs — which is a real answer
 * the block already renders, not an error state to guard against.
 */
const COMPARATOR_CAPABILITY = 'cap.bulk_plugin_update';

interface State {
  messages: UIMessage[];
  input: string;
  streaming: boolean;
  streamingId: string | null;
  providerId: string;
  model: string;
  // Local copy of sessionId so CHAT_STOP/CHAT_TOOL_APPROVE always have it
  // even before the parent re-render propagates the prop update.
  activeSessionId: string | null;
  offline: boolean;
  // Tracks the DB-persisted action_count so persistSession never resets it to 0.
  actionCount: number;
  // Mirrors chatRetentionDays setting; null means keep forever.
  retentionDays: number | null;
  expandedTools: Set<string>;
  /**
   * WP-27 · the procedure rail, folded from the three stream events. The panel
   * consumes ONE stream, so procedure events arrive beside tokens and tool rows;
   * `applyProcedureEvent` returns the same object for everything else, which is
   * what keeps a rail from being rebuilt on every character of output.
   */
  procedure: ProcedureStreamState;
  /**
   * WP-41 · the comparator, open or not.
   *
   * INTERIM, and named so at the gate: a disclosure above the composer is this
   * packet's own choice, not a ratified one. What IS ratified is that the shape
   * comes before any prose about it, so opening the comparator draws the matrix
   * rather than a description of it.
   */
  comparatorOpen: boolean;
  /**
   * WP-41 · the comparisons this machine can draw, or none.
   *
   * **PARITY.** It lives here rather than inside the comparator because the
   * panel must render NO comparator chrome at all for a user who has nothing to
   * compare — a dark core, an unfolded ledger, a fleet recorded at one place.
   * `panelChat-procedure-parity.test.tsx` pins that panel byte-identical to the
   * pre-WP-27 tree, and React children are positional: a `null` child is not the
   * same tree as no child. So the comparator is SPREAD from an array that is
   * empty until there is something to offer — the same shape, and the same
   * reason, as `renderProcedurePlan`.
   */
  comparatorFacts: ComparableFact[];
}

const styles = {
  root: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' },
  log: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0',
  },
  /**
   * The empty session. Same flex slot, but the content is centred rather than
   * top-anchored, which is what puts the composer in the middle of the column
   * instead of 700px below the invitation.
   */
  logEmpty: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center' as const,
  },
  /**
   * The empty session's COLUMN. Without it the block is a narrow strip
   * floating in whatever width the window happens to be — the centring works
   * vertically and does nothing horizontally, which is why a 2470px window
   * showed more void than content. 560px is what makes the composer read as
   * the centre of something.
   */
  logInnerEmpty: (stage: boolean) => ({
    width: stage ? 560 : '100%',
    maxWidth: '100%',
    margin: '0 auto',
    padding: stage ? '12px 0' : '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 11,
  }),
  logInner: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  /**
   * A message you SENT should be quiet — it is the one thing on screen you
   * already know, because you just typed it. This was a full-bleed
   * full-strength brand fill, which made it the loudest object on the panel
   * and broke the design system's own rule that the teal belongs to the
   * logomark and the agent avatar, "never as a page background". The sheet's
   * treatment: an 8% tint with a hairline, right-aligned, capped at 80%.
   */
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    background: 'rgba(14,202,212,0.08)',
    boxShadow: 'inset 0 0 0 1px rgba(14,202,212,0.2)',
    color: 'var(--nxai-card-text)',
    borderRadius: '14px 14px 4px 14px',
    padding: '10px 14px',
    fontSize: 13.5,
    lineHeight: 1.55,
    wordBreak: 'break-word' as const,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    background: 'var(--nxai-card-border)',
    color: 'var(--nxai-card-text)',
    borderRadius: '2px 12px 12px 12px',
    padding: '8px 12px',
    fontSize: 13,
    maxWidth: 580,
    wordBreak: 'break-word' as const,
    // whiteSpace: 'pre-wrap' — removed; markdown renderer handles whitespace
  },
  systemLine: {
    alignSelf: 'center',
    background: 'var(--nxai-section-bg)',
    color: UI_COLORS.WPE_BRAND,
    borderRadius: 12,
    padding: '3px 10px',
    fontSize: 11,
    textAlign: 'center' as const,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 14px',
    borderTop: `1px solid var(--nxai-card-border)`,
    background: 'var(--nxai-card-bg)',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    background: 'var(--nxai-input-bg)',
    border: `1px solid var(--nxai-card-border)`,
    borderRadius: 6,
    color: 'var(--nxai-card-text)',
    fontSize: 13,
    padding: '8px 10px',
    resize: 'none' as const,
    outline: 'none',
    fontFamily: 'inherit',
    minHeight: 36,
    maxHeight: 120,
  },
  sendBtn: (disabled: boolean) => ({
    background: disabled ? 'var(--nxai-card-border)' : UI_COLORS.WPE_BRAND,
    border: 'none',
    borderRadius: 6,
    color: disabled ? 'var(--nxai-card-sub)' : UI_COLORS.NEXUS_MARK,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 18,
    padding: '0 14px',
    fontWeight: 700,
    alignSelf: 'flex-end',
    height: 36,
  }),
};

/** Fire-and-forget telemetry helper. Never throws. */
function track(ipcRenderer: any, event: string, properties: Record<string, unknown> = {}) {
  try { ipcRenderer.send(IPC_CHANNELS.TELEMETRY_TRACK, { event, properties }); } catch (_) {}
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const trimmed = text.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
}

/**
 * Provider labels for the P0-5 disclosure line.
 *
 * TYPED `Record<AIProvider, string>` ON PURPOSE. This map lost track of the
 * union once already: `power` was added to `AIProvider` and not to this
 * object, so `providerLabel` fell through to `?? id` and the disclosure read
 * "power · sends site data" — a config key on the one line whose job is
 * naming, recognisably, who receives the user's site data. A disclosure that
 * names nothing a person recognises is the failure the line exists to
 * prevent. With this type, the next provider added to the union is a COMPILE
 * ERROR here rather than a key on screen.
 */
const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
  ollama: 'Ollama',
  'local-gateway': 'Gateway',
  power: 'WP Engine Power',
};

/**
 * Never returns a raw config key. An id outside the union can still arrive
 * from stale settings on disk, and the honest answer there is a phrase a
 * person can act on ("your configured AI provider") rather than a token they
 * have never seen — the disclosure still says data is being sent, which is
 * the part that must not be lost.
 */
function providerLabel(id: string): string {
  return PROVIDER_LABELS[id as AIProvider] ?? 'your configured AI provider';
}

const TOOL_NAMES: Record<string, string> = {
  fleet_overview: 'Fleet Overview',
  fleet_search: 'Fleet Search',
  fleet_sql: 'Fleet SQL Query',
  fleet_health_summary: 'Fleet Health Check',
  fleet_filter: 'Fleet Filter',
  fleet_summary: 'Fleet Summary',
  nexus_list_sites: 'List Sites',
  nexus_site_audit: 'Site Audit',
  nexus_site_refresh: 'Refresh Site',
  get_site_structure: 'Get Site Structure',
  get_site_health: 'Site Health',
  wp_plugin_list: 'List Plugins',
  wp_plugin_update: 'Update Plugin',
  wp_plugin_install: 'Install Plugin',
  wp_plugin_activate: 'Activate Plugin',
  wp_plugin_deactivate: 'Deactivate Plugin',
  wp_core_update: 'Update WordPress Core',
  wp_core_version: 'Check WordPress Version',
  wp_site_health: 'Site Health Check',
  wp_eval: 'Run PHP Code',
  wp_search_replace: 'Search & Replace Database',
  local_wpe_push: 'Push to WP Engine',
  local_wpe_pull: 'Pull from WP Engine',
  local_clone_site: 'Clone Site',
  local_delete_site: 'Delete Local Site',
  local_export_site: 'Export Site',
  wpe_promote_environment: 'Promote Environment',
  wpe_delete_install: 'Delete WP Engine Install',
  wpe_delete_site: 'Delete WP Engine Site',
  clean_database_items: 'Clean Database',
  scan_database_health: 'Scan Database Health',
  reindex_site: 'Reindex Site',
  search_site_content: 'Search Site Content',
};

const TOOL_EFFECTS: Record<string, string> = {
  local_wpe_push: 'Overwrites the live WP Engine environment with local files.',
  local_wpe_pull: 'Overwrites local site with files from WP Engine.',
  local_delete_site: 'Permanently removes the local site and all its files.',
  wpe_delete_install: 'Permanently deletes a WP Engine environment and all its content.',
  wpe_delete_site: 'Permanently deletes a WP Engine site and all its installs.',
  wpe_promote_environment: 'Overwrites the destination environment with source content.',
  clean_database_items: 'Permanently removes selected database rows.',
  wp_core_update: 'Updates WordPress core files on the site.',
  wp_plugin_install: 'Installs a new plugin on the site.',
  wp_plugin_update: 'Updates plugin files on the site.',
  wp_search_replace: 'Modifies data across the entire WordPress database.',
  wp_eval: 'Executes PHP code directly on the site.',
};

function toolDisplayName(name: string): string {
  return TOOL_NAMES[name] ?? name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function toolEffect(name: string): string {
  return TOOL_EFFECTS[name] ?? `Runs ${toolDisplayName(name)} on your WordPress sites.`;
}

export class PanelChat extends React.Component<Props, State> {
  private logRef = React.createRef<HTMLDivElement>();
  private inputRef = React.createRef<HTMLTextAreaElement>();
  private streamListener: ((_event: any, sessionId: string, event: any) => void) | null = null;
  private actionListener: ((...args: any[]) => void) | null = null;
  private clearListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;
  private onlineListener: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      messages: [],
      input: '',
      streaming: false,
      streamingId: null,
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
      activeSessionId: props.sessionId,
      offline: false,
      actionCount: 0,
      retentionDays: 30,
      expandedTools: new Set<string>(),
      procedure: emptyProcedureState(),
      comparatorOpen: false,
      comparatorFacts: [],
    };
    this.handleInput = this.handleInput.bind(this);
    this.handleSend = this.handleSend.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleStop = this.handleStop.bind(this);
    this.handleApprove = this.handleApprove.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
  }

  componentDidMount() {
    this.streamListener = (_event: any, sessionId: string, event: any) => {
      // Only process events for our session
      if (sessionId !== this.state.activeSessionId) return;
      this.onStreamEvent(event);
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM, this.streamListener);

    this.loadComparatorFacts();

    // Listen for action count updates
    this.actionListener = (_event: any, sessionId: string, _data: { sessionId: string; actionCount: number }) => {
      if (sessionId !== this.state.activeSessionId) return;
      // Keep local actionCount in sync so persistSession writes the correct value.
      this.setState((s) => ({ actionCount: s.actionCount + 1 }));
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_SESSION_ACTION_RECORDED, this.actionListener);

    // Listen for chat-all-cleared (fired when user deletes all history via Settings)
    this.clearListener = () => {
      // Drop in-memory session and messages so the next persistSession has nothing to resurrect
      this.setState({ activeSessionId: null, messages: [], actionCount: 0 });
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_ALL_CLEARED, this.clearListener);

    // Listen for offline/online events
    this.offlineListener = () => this.setState({ offline: true });
    this.onlineListener = () => this.setState({ offline: false });
    window.addEventListener('offline', this.offlineListener);
    window.addEventListener('online', this.onlineListener);

    this.loadSettings();
    if (this.props.sessionId) {
      this.loadSession(this.props.sessionId);
    }
  }

  componentWillUnmount() {
    // Safety net: persist whatever we have so collapsing the panel never loses the active chat.
    // persistSession filters out streaming messages, so a partial save is always safe.
    const { messages, activeSessionId } = this.state;
    const sessionId = activeSessionId ?? this.props.sessionId;
    const hasContent = messages.some((m) => m.role !== 'system');
    console.log('[NexusAI] PanelChat unmounting — sessionId:', sessionId, 'messages:', messages.length, 'hasContent:', hasContent);
    if (sessionId && hasContent) {
      this.persistSession().catch(() => {});
    }

    if (this.streamListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM, this.streamListener);
      this.streamListener = null;
    }
    if (this.actionListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_SESSION_ACTION_RECORDED, this.actionListener);
      this.actionListener = null;
    }
    if (this.clearListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_ALL_CLEARED, this.clearListener);
      this.clearListener = null;
    }
    if (this.offlineListener) window.removeEventListener('offline', this.offlineListener);
    if (this.onlineListener) window.removeEventListener('online', this.onlineListener);

    this.props.onStreamingStatusChange?.(null);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.sessionId !== this.props.sessionId) {
      if (this.props.sessionId) {
        this.setState({ activeSessionId: this.props.sessionId });
        this.loadSession(this.props.sessionId);
      } else {
        // New chat — reset all message state
        this.setState({
          messages: [],
          activeSessionId: null,
          streaming: false,
          streamingId: null,
          actionCount: 0,
          input: '',
        });
      }
    }
  }

  async loadSettings() {
    try {
      const settings = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
      const providerId = settings?.aiProvider || 'anthropic';
      const model = settings?.aiModel || 'claude-sonnet-5';
      // chatRetentionDays: undefined means the setting was never saved — keep the 30-day default.
      const retentionDays = settings?.chatRetentionDays !== undefined
        ? (settings.chatRetentionDays as number | null)
        : 30;
      this.setState({ providerId, model, retentionDays });
    } catch {
      // Keep defaults
    }
  }

  async loadSession(sessionId: string) {
    console.log('[NexusAI] loadSession — loading', sessionId);
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.CHAT_SESSION_GET,
        { sessionId },
      );
      console.log('[NexusAI] loadSession — result:', result ? `${result.messages?.length ?? 0} messages` : 'null');
      if (!result) return;
      const messages: UIMessage[] = (result.messages ?? []).map((m: ChatMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        incomplete: m.incomplete,
      }));
      // Restore the DB-persisted action count so persistSession never resets it to 0.
      const actionCount: number = result.session?.actionCount ?? 0;
      this.setState({ messages, actionCount });
    } catch (err) {
      console.error('[NexusAI] loadSession failed:', err);
    }
  }

  onStreamEvent(event: any) {
    const { streamingId } = this.state;
    if (event.type === 'token') {
      this.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === streamingId ? { ...m, content: m.content + event.text } : m,
        ),
      }));
    } else if (event.type === 'tool_call_start') {
      // Show a non-blocking running indicator — main process executes read tools immediately.
      // Only tier-3 tools pause for approval (tool_call_approval_needed fires later).
      this.setState((s) => {
        const msgs = s.messages.map((m) => {
          if (m.id !== streamingId) return m;
          return {
            ...m,
            toolCalls: [
              ...(m.toolCalls ?? []),
              { id: event.id, name: event.name, args: '', status: 'running' as const },
            ],
          };
        });
        return { messages: msgs };
      });
      this.props.onStreamingStatusChange?.('Working…');
    } else if (event.type === 'tool_call_approval_needed') {
      // Tier-3 destructive tool — upgrade whichever message owns this toolCall id.
      // WP-26: and carry the procedure block through when the platform sent one.
      this.setState((s) => ({
        messages: s.messages.map((m) => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map((tc) =>
            tc.id === event.id
              ? {
                  ...tc,
                  status: 'awaiting_approval' as const,
                  ...(event.warning ? { warning: event.warning } : {}),
                  ...(event.procedure ? { procedure: event.procedure } : {}),
                }
              : tc,
          ),
        })),
      }));
    } else if (event.type === 'tool_call_result') {
      // Tool finished — capture the result, AND whether it succeeded.
      //
      // WP-36 · `isError` used to be dropped here, and the cost was not
      // cosmetic. On 2026-08-19 the sequence guard REFUSED `verify_site_live`
      // (`cp.backup is not attested`) and this panel painted a green ✓ beside
      // it; the smoke read the screenshot as a declared tool executing out of
      // sequence and opened an incident investigation into a thing that never
      // happened. A fired gate rendered as a completed act is completion-state
      // fabrication by rendering — the same class as claiming a verification
      // the platform does not have, committed by a status field instead of a
      // sentence. `ToolCallState` has always DECLARED an `'error'` status;
      // nothing assigned it, which is where the defect lived.
      this.setState((s) => ({
        messages: s.messages.map((m) => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map((tc) =>
            tc.id === event.id
              ? {
                  ...tc,
                  status: (event.isError ? 'error' : 'done') as 'error' | 'done',
                  result: event.result ?? '',
                }
              : tc,
          ),
        })),
      }));
    } else if (event.type === 'error') {
      this.setState((s) => ({
        streaming: false,
        streamingId: null,
        messages: [
          ...s.messages.filter((m) => m.id !== s.streamingId),
          { id: makeId(), role: 'system' as const, content: `Error: ${event.message}` },
        ],
      }));
      this.props.onStreamingStatusChange?.(null);
    } else if (event.type === 'citation_supply') {
      // WP-43 · THE SWAP POINT WP-38 NAMED, taken. The host delivers this
      // turn's supply and manifest once, immediately before `done`; the field
      // it lands on is the whole contract, and everything downstream —
      // `citationRender`, the three faces, the peek — is WP-38's, unchanged.
      //
      // Attached to the STREAMING message and to no other. A payload written
      // across the whole list would re-render every earlier reply in the
      // session against this turn's supply, which is retroactive citation: the
      // one thing the sheet says "would make every link untrustworthy".
      this.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === streamingId
            ? { ...m, citation: { supply: event.supply, manifest: event.manifest, moment: event.moment } }
            : m,
        ),
      }));
    } else if (
      event.type === 'procedure_armed' ||
      event.type === 'checkpoint_changed' ||
      event.type === 'procedure_aborted'
    ) {
      // The ONE swap point. WP-26's emitter puts these three shapes on this same
      // stream; until it lands, `procedureStream.fake.ts` produces them from
      // fixtures. Nothing below this line knows or cares which delivered them.
      this.setState((s) => {
        const next = applyProcedureEvent(s.procedure, event);
        return next === s.procedure ? null : ({ procedure: next } as Pick<State, 'procedure'>);
      });
    } else if (event.type === 'done') {
      this.setState(
        (s) => ({
          streaming: false,
          streamingId: null,
          messages: s.messages.map((m) =>
            m.id === streamingId ? { ...m, streaming: false } : m,
          ),
        }),
        () => {
          this.persistSession();
          this.props.onStreamingStatusChange?.(null);
        },
      );
    }
    this.scrollToBottom();
  }

  scrollToBottom() {
    const el = this.logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    this.setState({ input: e.target.value });
  }

  /**
   * An opening ask, taken.
   *
   * IT FILLS THE COMPOSER AND DOES NOT SEND. The panel is offering a question,
   * not asking it: a click that sent would make three suggestions three ways to
   * start a turn nobody typed, and an ask the reader wanted to edit first would
   * be gone. The focus moves with the text so the next keystroke lands where the
   * reader is looking.
   */
  private takeOpeningAsk = (text: string) => (): void => {
    this.setState({ input: text }, () => {
      const el = this.inputRef.current;
      if (el) el.focus();
    });
  };

  /**
   * WP-49 · ITEM 4 — the opening state, drawn from the queue beside the panel.
   *
   * THREE THINGS, AND NOT ONE OF THEM IS COMPOSED HERE:
   *
   *  - the verdict is `TriageView`'s own, composed once in `sessionRegistry`
   *    over the rows the Now list renders (WP-48). This reads it.
   *  - the invitation and the asks come from `openingCopy.generated.ts` and
   *    `openingAsksModel`, filled with fields the fold derived.
   *  - the fallback, for a fleet with nothing waiting, is the panel's own
   *    existing line, unchanged.
   *
   * A blank is the one thing it cannot be: "the highest-frequency surface in the
   * product opens on a blank" is the defect item 4 names, and an opening state
   * that quietly degraded to one whenever the read failed would be the same
   * defect with a fallback path.
   */
  /** True on the full-screen board. See the `density` prop. */
  private isStage(): boolean {
    return this.props.density === 'stage';
  }

  private renderOpeningState(): React.ReactElement {
    const opening = this.props.opening;
    const style = { padding: '24px 0', color: 'var(--nxai-card-sub)', textAlign: 'center' as const, fontSize: 13 };

    if (!opening) {
      // The invitation, from the ratified sheet (newChatCopy.generated.ts).
      //
      // NO SUGGESTIONS HERE, deliberately. The sheet's pin is that suggestions
      // are QUESTIONS DERIVED from what is true right now; the fixture's three
      // are specimens of that derivation, not copy to ship. With no opening
      // queue there is nothing true to derive from, and rendering them anyway
      // would put a fabricated "open incident, 14h" on a quiet fleet — the
      // withhold-rather-than-guess rule, applied to an invitation. Derived
      // asks render in the queue branch below, where they are real.
      const stage = this.isStage();
      return React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: stage ? 'center' : 'flex-start',
            gap: 9,
            textAlign: stage ? ('center' as const) : ('left' as const),
          },
          'data-panel-opening': 'invitation',
        },
        // The headline is DISPLAY type. At body size the invitation reads as a
        // status line, and the 30px-against-13.5px contrast is the entire
        // hierarchy of this screen — flatten it and the subject becomes a
        // paragraph.
        React.createElement(
          'div',
          {
            key: 'headline',
            style: {
              fontSize: stage ? 30 : 22,
              lineHeight: stage ? '36px' : '28px',
              fontWeight: 600,
              letterSpacing: '-0.6px',
              color: 'var(--nxai-card-text)',
              margin: 0,
            },
          },
          NEW_CHAT_HEADLINE,
        ),
        React.createElement(
          'div',
          { key: 'promise', style: { fontSize: 13.5, lineHeight: 1.55, color: 'var(--nxai-card-sub)' } },
          // The companion drops the promise's SECOND clause rather than
          // shrinking it — a refusal states its own reason when it happens.
          stage ? NEW_CHAT_PROMISE : NEW_CHAT_PROMISE_SHORT,
        ),
      );
    }

    return React.createElement(
      'div',
      { style: { ...style, textAlign: 'left' as const, padding: '18px 14px' }, 'data-panel-opening': 'queue' },
      ...(opening.verdict
        ? [React.createElement(
            'div',
            { key: 'verdict', style: { color: 'var(--nxai-card-text)', fontSize: 13, lineHeight: 1.45 }, 'data-opening-verdict': 'true' },
            opening.verdict,
          )]
        : []),
      React.createElement('div', { key: 'invitation', style: { marginTop: 4, fontSize: 12 } }, opening.invitation),
      // The asks used to render here as full-width bars. They are now pills
      // BELOW the composer (renderComposerBlock) — same asks, same handler,
      // the treatment the sheet specifies.
    );
  }

  handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  async handleSend() {
    const { input, providerId, model } = this.state;
    if (!input.trim() || this.state.streaming) return;

    const userMsg: UIMessage = { id: makeId(), role: 'user', content: input.trim() };
    const assistantMsg: UIMessage = { id: makeId(), role: 'assistant', content: '', streaming: true };

    // Ensure session exists — generate locally if needed
    let sessionId = this.props.sessionId ?? this.state.activeSessionId;
    if (!sessionId) {
      sessionId = makeId();
      this.setState({ activeSessionId: sessionId });
      this.props.onSessionCreated(sessionId);
      try { track(this.props.electron.ipcRenderer, 'nexus_panel_session_created', {}); } catch (_) {}
    }

    this.setState(
      (s) => ({
        messages: [...s.messages, userMsg, assistantMsg],
        input: '',
        streaming: true,
        streamingId: assistantMsg.id,
      }),
      () => this.scrollToBottom(),
    );

    const siteId = this.props.selectedSiteIds[0];

    // CHAT_SEND positional args: sessionId, message, providerId, model, siteId?
    await this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.CHAT_SEND,
      sessionId,
      input.trim(),
      providerId,
      model,
      siteId,
    );
    try { track(this.props.electron.ipcRenderer, 'nexus_panel_message_sent', { siteCount: this.props.selectedSiteIds.length }); } catch (_) {}
  }

  /**
   * Start a new chat, imperatively.
   *
   * fixes-082526 · issue 1. The "+" control used to work only by side effect:
   * the container set `activeSessionId: null` and this component reset inside
   * `componentDidUpdate` — but ONLY when the prop actually changed. Whenever
   * the container's id was already null (the ordinary case before a session
   * has been minted, and any path that cleared it first), null -> null was no
   * change at all, `componentDidUpdate` never ran, and the transcript stayed
   * on screen while the button appeared to do nothing.
   *
   * A reset must not depend on a value having differed. This is the whole
   * action in one call: persist what is leaving (so it stays reachable from
   * Sessions rather than being discarded), then clear. `componentDidUpdate`
   * keeps its branch for genuine session SWITCHING, which is a different act.
   */
  async startNewChat(): Promise<void> {
    const hadContent = this.state.messages.some((m) => m.content.trim().length > 0);
    if (hadContent) {
      try { await this.persistSession(); } catch { /* a failed save must not block a new chat */ }
    }
    this.setState({
      messages: [],
      activeSessionId: null,
      streaming: false,
      streamingId: null,
      actionCount: 0,
      input: '',
    });
  }

  async persistSession() {
    try {
      const { messages, activeSessionId } = this.state;
      const sessionId = activeSessionId ?? this.props.sessionId;
      console.log('[NexusAI] persistSession — sessionId:', sessionId, 'total messages:', messages.length);
      if (!sessionId) return;

      const firstUser = messages.find((m) => m.role === 'user');
      const title = firstUser ? truncateAtWord(firstUser.content, 60) : 'New chat';

      const { actionCount, retentionDays } = this.state;
      const session: ChatSession = {
        id: sessionId,
        title,
        scopeLabel: `${this.props.selectedSiteIds.length} site${this.props.selectedSiteIds.length !== 1 ? 's' : ''}`,
        scopeSiteIds: this.props.selectedSiteIds,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        actionCount,
        expiresAt: retentionDays === null ? null : Date.now() + retentionDays * 86400000,
      };

      const chatMessages: ChatMessage[] = messages
        .filter((m) => m.role !== 'system')
        .filter((m) => !(m.role === 'assistant' && m.content === ''))
        .map((m) => ({
          id: m.id,
          sessionId,
          role: m.role,
          content: m.content,
          timestamp: Date.now(),
          incomplete: m.streaming ? true : undefined,
        }));

      console.log('[NexusAI] persistSession — saving', chatMessages.length, 'messages, title:', title);
      const saveResult = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_SAVE, {
        session,
        messages: chatMessages,
      });
      console.log('[NexusAI] persistSession — IPC result:', saveResult);
      this.props.onSessionSaved(session, chatMessages);
    } catch (err) {
      console.error('[NexusAI] persistSession failed:', err);
    }
  }

  handleStop() {
    const sessionId = this.state.activeSessionId ?? this.props.sessionId;
    if (sessionId) {
      this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_STOP, sessionId);
    }
    this.setState({ streaming: false, streamingId: null });
  }

  handleApprove(toolId: string, canaryPolicy?: string) {
    const sessionId = this.state.activeSessionId ?? this.props.sessionId;
    if (sessionId) {
      // The policy argument is OMITTED, not sent as undefined, when there is
      // none: absence is what the producer reads as "nobody chose", and it is
      // what keeps every pre-WP-26 approval byte-identical on the wire.
      const args: unknown[] = [IPC_CHANNELS.CHAT_TOOL_APPROVE, sessionId, toolId, true];
      if (canaryPolicy) args.push(canaryPolicy);
      (this.props.electron.ipcRenderer.invoke as (...a: unknown[]) => unknown)(...args);
    }
  }

  handleCancel(toolId: string) {
    const sessionId = this.state.activeSessionId ?? this.props.sessionId;
    if (sessionId) {
      this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.CHAT_TOOL_APPROVE,
        sessionId,
        toolId,
        false,
      );
    }
    this.setState((s) => ({
      messages: [
        ...s.messages,
        { id: makeId(), role: 'system' as const, content: 'Action dismissed.' },
      ],
    }));
  }

  renderToolExpansion(rawResult: string, key: string): React.ReactNode {
    let displayResult: string;
    try {
      const parsed = JSON.parse(rawResult);
      displayResult = typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : rawResult;
    } catch { displayResult = rawResult; }
    const truncated = displayResult.length > 2000 ? displayResult.slice(0, 2000) + '…' : displayResult;
    return React.createElement(
      'div',
      {
        key,
        style: {
          marginTop: 4, marginBottom: 4, borderLeft: `2px solid ${UI_COLORS.WPE_BRAND}`, paddingLeft: 10,
          fontSize: 12, color: 'var(--nxai-card-text)', maxHeight: 300, overflowY: 'auto' as const,
          background: 'var(--nxai-card-bg)', borderRadius: '0 4px 4px 0',
        },
      },
      React.createElement('pre', { style: { margin: 0, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const } }, truncated),
    );
  }

  renderMessage(msg: UIMessage) {
    // THE THINKING STATE. A streaming assistant turn with no content yet used
    // to render as nothing at all, so the panel showed a question and then
    // went silent — worse than the empty state, which at least carried an
    // invitation. There is no way to tell whether anything is happening.
    if (msg.role === 'assistant' && msg.streaming && !msg.content && (msg.toolCalls ?? []).length === 0) {
      return React.createElement(
        'div',
        {
          key: msg.id,
          'data-chat-thinking': 'true',
          style: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2, fontSize: 12, color: 'var(--nxai-card-sub)' },
        },
        this.props.streamingStatusLine ?? 'Thinking, stand by…',
      );
    }
    if (msg.role === 'system') {
      return React.createElement('div', { key: msg.id, style: styles.systemLine }, msg.content);
    }

    const { expandedTools } = this.state;
    const allCalls = msg.toolCalls ?? [];

    // Running chips — show one per active call (usually 0 or 1 at a time)
    const runningChips = allCalls
      .filter((tc) => tc.status === 'running')
      .map((tc) => React.createElement(
        'div',
        { key: tc.id, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', color: 'var(--nxai-card-sub)', fontSize: 12 } },
        React.createElement('span', { style: { color: UI_COLORS.WPE_BRAND, fontSize: 13 } }, '⚡'),
        React.createElement('span', null, toolDisplayName(tc.name)),
        React.createElement('span', { style: { opacity: 0.5 } }, '…'),
      ));

    // Approval cards — render individually
    const approvalCards = allCalls
      .filter((tc) => tc.status === 'awaiting_approval')
      .map((tc) => tc.procedure
        ? React.createElement(ProcedureApprovalCard, {
            key: tc.id,
            // WP-36 · THE SUBJECT IS THE CHECKPOINT, not the tool.
            //
            // These two props read `tc.name` before this fix, and on 2026-08-19
            // that produced "Verify Site Live" over "Runs Verify Site Live on
            // your WordPress sites." — a read-shaped tool name heading the card
            // that attests `cp.approval`, the runbook's "explicit, informed
            // consent" to the whole update plan. The tool is incidental here:
            // `cp.approval` declares none, and the card is raised for whichever
            // one the guard happened to be refusing. The runbook's own heading
            // for the step is the subject; no effect line is passed, because
            // the honest one is absent rather than tool-shaped.
            title: tc.procedure.checkpointReason ?? tc.procedure.checkpointId,
            warning: tc.warning ?? '',
            procedure: tc.procedure,
            onApprove: (canaryPolicy?: string) => {
              this.handleApprove(tc.id, canaryPolicy);
              try { track(this.props.electron.ipcRenderer, 'nexus_panel_action_confirmed', { destructive: false }); } catch (_) {}
              this.inputRef.current?.focus();
            },
            onDeny: () => { this.handleCancel(tc.id); this.inputRef.current?.focus(); },
          })
        : React.createElement(ActionCard, {
        key: tc.id,
        title: toolDisplayName(tc.name),
        effect: toolEffect(tc.name),
        destructive: tc.name in TOOL_EFFECTS,
        onConfirm: () => {
          this.handleApprove(tc.id);
          try { track(this.props.electron.ipcRenderer, 'nexus_panel_action_confirmed', { destructive: false }); } catch (_) {}
          this.inputRef.current?.focus();
        },
        onCancel: () => { this.handleCancel(tc.id); this.inputRef.current?.focus(); },
      }));

    // Settled chips — group repeated calls to the same tool into one row.
    //
    // Grouped by tool AND status (WP-36): a refused call and a successful call
    // of the same tool are different outcomes, and folding them into one row
    // would put a single mark on two different answers — which is the defect
    // this fix exists to close, reintroduced one level up.
    const doneCalls = allCalls.filter(
      (tc) => (tc.status === 'done' || tc.status === 'error') && tc.result !== undefined,
    );
    const doneGroups = new Map<string, typeof doneCalls>();
    for (const tc of doneCalls) {
      const key = `${tc.status}|${tc.name}`;
      if (!doneGroups.has(key)) doneGroups.set(key, []);
      doneGroups.get(key)!.push(tc);
    }
    const doneChips = Array.from(doneGroups.entries()).map(([key, calls]) => {
      const name = calls[0].name;
      const failed = calls[0].status === 'error';
      const groupKey = `group-${msg.id}-${key}`;
      const isExpanded = expandedTools.has(groupKey);
      const label = calls.length > 1
        ? `${toolDisplayName(name)} · ${calls.length}`
        : toolDisplayName(name);
      return React.createElement(
        'div',
        { key: groupKey },
        React.createElement(
          'div',
          {
            style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', color: 'var(--nxai-card-sub)', fontSize: 12, cursor: 'pointer', userSelect: 'none' as const },
            onClick: () => this.setState((s) => {
              const next = new Set(s.expandedTools);
              next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
              return { expandedTools: next };
            }),
          },
          React.createElement(
            'span',
            {
              style: {
                color: failed ? UI_COLORS.STATUS_ERROR : UI_COLORS.STATUS_RUNNING,
                fontSize: 13,
              },
              // The mark carries the outcome for a reader who cannot see colour;
              // colour alone would leave a refusal and a success identical to
              // them, which is the same failure with a narrower audience.
              'aria-label': failed ? 'did not run' : 'completed',
            },
            failed ? '✕' : '✓',
          ),
          React.createElement('span', null, label),
          React.createElement('span', { style: { fontSize: 10, opacity: 0.6, marginLeft: 2 } }, isExpanded ? '▾' : '▸'),
        ),
        isExpanded
          ? React.createElement(
              'div',
              { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginTop: 2 } },
              ...calls.map((tc, i) => this.renderToolExpansion(tc.result ?? '', `${groupKey}-${i}`)),
            )
          : null,
      );
    });

    const toolCards = [...runningChips, ...approvalCards, ...doneChips].filter(Boolean);

    const hasToolActivity = allCalls.length > 0;

    let bubbleElement: React.ReactNode;
    if (msg.role === 'assistant') {
      if (msg.streaming && !msg.content && hasToolActivity) {
        // Tools are running and nothing has been written yet. Rendering the bubble here
        // produced an empty grey slab above the tool list — a container for text that did
        // not exist. The tool rows are the progress; they do not need a frame around
        // nothing. Three dots would be wrong too: it is not typing, it is working, and
        // the header already says so.
        bubbleElement = null;
      } else if (msg.streaming && !msg.content) {
        bubbleElement = React.createElement(
          'div',
          { style: { ...styles.assistantBubble, whiteSpace: 'normal' as const } },
          React.createElement('span', { className: 'nexus-typing' },
            React.createElement('span', null, '●'),
            React.createElement('span', null, '●'),
            React.createElement('span', null, '●'),
          ),
        );
      } else {
        // WP-38 · the corroboration render. A turn that carries citation data
        // draws its claims with trailing doors (ADR-24's three states); a turn
        // that carries none renders exactly as it did before this packet — the
        // additive-parity precondition, pinned by `panelChat-citation.test.tsx`.
        // The whole reply still goes through `renderMarkdown`, so the raw-HTML
        // suppression above governs both paths.
        bubbleElement = React.createElement(
          'div',
          null,
          msg.citation
            ? React.createElement(
                'div',
                { style: { ...styles.assistantBubble, whiteSpace: 'normal' as const } },
                React.createElement(CitationSpans, {
                  turn: { ...msg.citation, reply: msg.content },
                  renderMarkdown,
                })
              )
            : React.createElement('div', {
                style: { ...styles.assistantBubble, whiteSpace: 'normal' as const },
                className: 'nexus-md',
                dangerouslySetInnerHTML: { __html: renderMarkdown(msg.content) },
              }),
          msg.incomplete
            ? React.createElement(
                'div',
                {
                  style: {
                    fontSize: 11,
                    color: 'var(--nxai-card-sub)',
                    fontStyle: 'italic' as const,
                    marginTop: 6,
                    paddingLeft: 12,
                    borderLeft: '2px solid var(--nxai-card-border)',
                  },
                },
                'Response interrupted',
              )
            : null,
        );
      }
    } else {
      // User bubble — plain text, no markdown
      bubbleElement = React.createElement('div', { style: styles.userBubble }, msg.content);
    }

    // Tool rows come BEFORE the bubble: they happened first, and the answer is the
    // conclusion drawn from them. Rendering them after put the working-out below the
    // result and, while streaming, pushed the live rows off the bottom of the transcript.
    return React.createElement(
      'div',
      { key: msg.id },
      ...toolCards,
      bubbleElement,
    );
  }

  /**
   * The approval the panel is waiting on, or null.
   *
   * WP-35 · the block yields to the card, never the reverse (the fold, pin 1),
   * and the panel is the only surface that knows a card is up. It reads its own
   * tool calls for that fact and hands it down; `ProcedureSurfaces` does not go
   * looking, and nothing here derives checkpoint state.
   */
  pendingProcedureApproval(): ProcedureApprovalContext | null {
    for (const message of this.state.messages) {
      for (const call of message.toolCalls ?? []) {
        if (call.status === 'awaiting_approval' && call.procedure) return call.procedure;
      }
    }
    return null;
  }

  /**
   * The declared block, PINNED TO THE TOP OF THE SESSION (the fold's ruled
   * composite, 1a): XD-3 as geometry — the procedure outranks the transcript,
   * so it holds the top and the turns move beneath it.
   *
   * Empty until something arms, and empty for the empty run — a plan of zero
   * cells opens no container, so it renders as a turn's attachment instead
   * (`renderProcedurePlan`). Spread rather than a conditional child: a `null`
   * in a children array is still an entry in it, and the parity pin says this
   * tree is byte-identical to the pre-WP-27 one whenever nothing is armed.
   */
  /**
   * WP-44 · THE DOOR'S HANDLER. Doors-need-handlers is law, and this is it.
   *
   * Until now every `onGovern` prop in this tree was left undefined, so
   * `ScopeBlock` rendered its door DISABLED — deliberately honest, because a
   * door that opens nothing is worse than no door. The Govern matrix is the
   * thing behind it, so the door now opens.
   *
   * IT PUBLISHES THE TARGET; IT DOES NOT GRANT ANYTHING. XD-8: consent that must
   * be recorded is made at a control, never elicited in chat — and a grant made
   * from inside the panel that is refusing would be exactly the conversational
   * shortcut J-Refusal's third must-not forbids. What crosses this boundary is a
   * request to SHOW a row, and the act stays on the row.
   */
  private handleGovernDoor = (door: GovernDoorTarget): void => {
    nexusStore.update({ governDoorRequest: door });
  };

  renderProcedureSurfaces(): React.ReactNode[] {
    if (!hasProcedureSurface(this.state.procedure)) return [];
    const { procedure, abort } = this.state.procedure;
    if (procedure && !opensContainer(procedure)) return [];
    const approval = this.pendingProcedureApproval();
    return [
      React.createElement(ProcedureSurfaces, {
        key: 'procedure',
        procedure,
        abort,
        approvalPending: !!approval,
        gateCheckpointId: approval ? approval.checkpointId : null,
        onGovern: this.handleGovernDoor,
      }),
    ];
  }

  /**
   * XD-21 · the empty run. No block, no checkpoint list: the refusal stays a
   * turn and the derived plan attaches to it, in the flow, where the turn is.
   */
  renderProcedurePlan(): React.ReactNode[] {
    const { procedure } = this.state.procedure;
    if (!procedure || opensContainer(procedure)) return [];
    return [
      React.createElement(ProcedureSurfaces, {
        key: 'procedure-plan',
        procedure,
        abort: null,
        onGovern: this.handleGovernDoor,
      }),
    ];
  }

  /**
   * WP-41 · the comparator and its disclosure, or NOTHING.
   *
   * An empty array, not a `null` child: React children are positional, and the
   * parity fixture is a serialized tree captured before any of this existed. A
   * user with no comparable facts must get the identical tree, which means the
   * chrome cannot merely be hidden — it has to be absent.
   *
   * INTERIM: the disclosure's wording and placement are this packet's own, not
   * ratified. What is ratified is that opening it draws the SHAPE rather than a
   * description of it.
   */
  renderComparator(): React.ReactNode[] {
    const { comparatorFacts, comparatorOpen } = this.state;
    if (!comparatorFacts.length) return [];
    return [
      comparatorOpen
        ? React.createElement(ComparatorPanel, {
            key: 'comparator',
            electron: this.props.electron,
            capability: COMPARATOR_CAPABILITY,
            facts: comparatorFacts,
            onGovern: this.handleGovernDoor,
          })
        : null,
      React.createElement(
        'button',
        {
          key: 'comparator-toggle',
          type: 'button',
          style: {
            alignSelf: 'flex-start' as const,
            margin: '0 10px 4px',
            background: 'transparent',
            border: 'none',
            padding: 0,
            font: 'inherit',
            fontSize: 11,
            color: UI_COLORS.WPE_BRAND,
            cursor: 'pointer',
          },
          'data-comparator-toggle': String(comparatorOpen),
          onClick: () => this.setState((prev) => ({ comparatorOpen: !prev.comparatorOpen })),
        },
        comparatorOpen ? 'Close the comparison' : 'Compare across places',
      ),
    ];
  }

  /**
   * WP-41 · ask once, on mount, what can be compared at all. Failure is silence:
   * the array stays empty and the panel is exactly what it was.
   *
   * **THE RESULT IS NOT ASSUMED THENABLE.** `invoke` returning something that
   * is not a promise — an older host, a partial test double, a channel with no
   * registered handler — used to throw straight out of `componentDidMount` and
   * take the WHOLE PANEL down with it, comparator and chat alike. That is the
   * seam's one prohibition ("intelligence-layer failures must never break a
   * surface that predates the intelligence layer"), and it was caught by
   * `chat-all-cleared.test.ts`, whose double returns `undefined` for channels
   * it does not know. Everything here is inside the guard for that reason.
   */
  private loadComparatorFacts(): void {
    try {
      const pending = this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.COMPARATOR_FACTS);
      if (!pending || typeof (pending as { then?: unknown }).then !== 'function') return;
      Promise.resolve(pending)
        .then((facts: unknown) => {
          if (Array.isArray(facts) && facts.length) {
            this.setState({ comparatorFacts: facts as ComparableFact[] });
          }
        })
        .catch(() => { /* nothing to compare is not an error */ });
    } catch {
      /* a host without this channel is a host with nothing to compare */
    }
  }

  /**
   * The composer.
   *
   * Extracted so it can be rendered in TWO places — and that is the whole
   * point of the new-chat sheet. On an empty session it belongs directly
   * under the invitation, in the vertical middle; only once there is a
   * transcript for it to sit under does it take the bottom. The shipped
   * screen pinned it to the bottom of an empty column and floated the
   * invitation in the top third, so the one thing you came to do was the
   * furthest thing from what you were reading.
   */
  renderComposerBlock(): React.ReactNode[] {
    const { offline, input, streaming, providerId, model } = this.state;
    const providerName = providerLabel(providerId);
    const modelName = model;
    const composer = (
        offline
          ? React.createElement(
              'div',
              {
                style: {
                  padding: 12,
                  color: 'var(--nxai-warn-text)',
                  textAlign: 'center' as const,
                  fontSize: 12,
                  background: 'var(--nxai-card-bg)',
                  borderTop: `1px solid var(--nxai-card-border)`,
                },
              },
              'No network connection — history is still available.',
            )
          : React.createElement(
              'div',
              { style: styles.inputRow },
              React.createElement('textarea', {
                ref: this.inputRef,
                style: styles.textarea,
                value: input,
                onChange: this.handleInput,
                onKeyDown: this.handleKeyDown,
                // Written to the MOUNT'S WIDTH. The placeholder wraps rather
                // than truncating, so the stage string in a 380px field clips
                // its last word against the bottom edge — the fixture carries
                // a short form for exactly this case.
                placeholder: this.isStage() ? NEW_CHAT_PLACEHOLDER : NEW_CHAT_PLACEHOLDER_SHORT,
                disabled: streaming,
                rows: 1,
                'aria-label': 'Chat input',
              }),
              React.createElement(
                'button',
                {
                  style: styles.sendBtn(streaming || !input.trim()),
                  disabled: streaming || !input.trim(),
                  onClick: streaming ? this.handleStop : this.handleSend,
                  'aria-label': streaming ? 'Stop generation' : 'Send message',
                },
                streaming ? '■' : '↑',
              ),
            )
    );

    // The scope row and the disclosure BELONG TO THE COMPOSER, so they move
    // with it. When the composer came up to the centre of an empty session and
    // these two stayed pinned to the bottom, the line describing what the
    // question is about — and the line naming who receives the data — sat some
    // 340px below the field they describe. For a P0-5 disclosure that is worse
    // than where it started: adjacency IS the disclosure.
    const stage = this.isStage();
    // Suggestions sit BELOW the field and are sized to their content. As
    // full-width bars above it they read as disabled inputs, and two of them
    // filling the width implied there were only two things one could ask.
    // Empty session only: with a transcript the invitation is spent.
    const emptySession = this.state.messages.length === 0;
    // THE DERIVED ASKS, never the fixture's. NEW_CHAT_SUGGESTIONS are
    // SPECIMENS of a derivation ("an open incident, 14h"); shipping them
    // would put a fabricated incident on a quiet fleet. `opening.asks` is the
    // real thing, and it is what needed the pill treatment — it was rendering
    // as full-width grey bars ABOVE the field, which read as disabled inputs.
    const derivedAsks = this.props.opening?.asks ?? [];
    const pills = emptySession && derivedAsks.length > 0
      ? React.createElement(
          'div',
          {
            key: 'suggestions',
            style: {
              display: 'flex',
              flexWrap: 'wrap' as const,
              gap: stage ? 8 : 7,
              justifyContent: stage ? ('center' as const) : ('flex-start' as const),
              flexDirection: stage ? ('row' as const) : ('column' as const),
              alignItems: stage ? ('center' as const) : ('flex-start' as const),
            },
          },
          ...derivedAsks.map((sug) =>
            React.createElement(
              'button',
              {
                key: sug.classId,
                'data-opening-ask': sug.classId,
                'data-opening-ask-row': sug.situationId,
                onClick: this.takeOpeningAsk(sug.text),
                style: {
                  // Content-sized, never full-width: a pill, not a field.
                  width: 'auto',
                  alignSelf: stage ? undefined : ('flex-start' as const),
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 9999,
                  border: '1px solid var(--nxai-card-border)',
                  background: 'transparent',
                  color: 'var(--nxai-card-text)',
                  font: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap' as const,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              sug.text,
            ),
          ),
        )
      : null;

    const footnote = emptySession
      ? React.createElement(
          'div',
          {
            key: 'footnote',
            style: {
              fontSize: stage ? 12 : 11.5,
              lineHeight: 1.5,
              color: 'var(--nxai-card-sub)',
              textAlign: stage ? ('center' as const) : ('left' as const),
            },
          },
          NEW_CHAT_FOOTNOTE,
        )
      : null;

    return [
      React.createElement(React.Fragment, { key: 'composer' }, composer),
      pills,
      footnote,
      React.createElement(SiteContextStrip, { key: 'scope', ...this.props.siteContext }),
      React.createElement(
        'div',
        {
          key: 'disclosure',
          style: { padding: '3px 14px 6px', color: 'var(--nxai-card-sub)', fontSize: 10, display: 'flex', gap: 6, flexShrink: 0 },
        },
        React.createElement(
          'span',
          { title: `${providerId}/${modelName} · ${NEW_CHAT_DISCLOSURE.tooltip.split('· ').slice(1).join('· ')}` },
          `${providerName} · sends site data`,
        ),
      ),
    ];
  }


  render() {
    const { messages, input, streaming, offline, providerId, model } = this.state;

    const providerName = providerLabel(providerId);
    const modelName = model;

    return React.createElement(
      'div',
      { style: styles.root },
      // WP-35 · the declared block, pinned above the transcript. The turns move
      // beneath it; it does not move with them.
      ...this.renderProcedureSurfaces(),
      React.createElement(
        'div',
        {
          ref: this.logRef,
          // New-chat sheet: on an empty session the column CENTRES, so the
          // invitation and the composer sit together in the vertical middle.
          // With a transcript it scrolls from the top as before.
          style: messages.length === 0 ? styles.logEmpty : styles.log,
          'aria-live': 'polite',
          'data-nexus-chat': true,
        },
        React.createElement(
          'div',
          { style: messages.length === 0 ? styles.logInnerEmpty(this.isStage()) : styles.logInner },
          messages.length === 0 ? this.renderOpeningState() : null,
          // The composer sits HERE while the session is empty — directly under
          // the invitation — and moves to the bottom on the first turn, when
          // there is finally a transcript for it to sit under.
          ...(messages.length === 0 ? this.renderComposerBlock() : []),
          messages.map((m) => this.renderMessage(m)),
          // The empty run's derived plan, attached where the refusal turn is.
          ...this.renderProcedurePlan(),
        ),
      ),
      // Directly above the composer, and above BOTH branches below: which site the chat
      // is scoped to is true whether or not the network is. It is also the disclosure
      // that scope moved when the user navigates mid-session — no toast, no modal, the
      // band just changes, and the next turn carries the new id.
      // WP-41 · the comparator, spread from an array — empty when there is
      // nothing to compare, so a user it cannot serve sees the panel unchanged.
      ...this.renderComparator(),
      ...(messages.length === 0 ? [] : this.renderComposerBlock()),
    );
  }
}
