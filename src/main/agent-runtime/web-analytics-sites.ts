/**
 * Read-only window onto web-analytics' GA4 bindings for the renderer.
 *
 * The bindings live in `agent_state` (graph.db) under `ga4Property:<siteName>`, written by the
 * agent's own `map_property` tool. The Sites tab reads them directly here, the same way
 * log-processor's tab reads its sqlite file — a plain SELECT does not need to travel through the
 * agent runtime.
 *
 * Bindings are read, never written, on this path. Binding and unbinding go through the agent's
 * tool via AGENT_TOOL_INVOKE, so they stay on the audited dispatch chokepoint.
 */

const KEY_PREFIX = 'ga4Property:';

export interface Ga4Binding {
  /** GA4 resource name, e.g. `properties/447120388`. */
  property: string;
  /** The label the user picked in Google. Absent on bindings written before v0.2.0. */
  displayName?: string;
  boundAt?: number;
}

export interface WebAnalyticsState {
  /** Site name → binding. Sites with no binding are simply absent. */
  bindings: Record<string, Ga4Binding>;
}

/**
 * Accepts both binding shapes. v0.1.0 stored the bare property id; v0.2.0 stores a JSON record so
 * the UI can show the property's name without a Google round trip. An older row must keep working
 * rather than silently read as unbound — that would present a bound site as needing setup and
 * invite a second, conflicting binding.
 */
export function parseBinding(raw: string | null | undefined): Ga4Binding | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  if (value === '') return undefined;

  // Unwrap AgentStateStore's own envelope. `set()` JSON-stringifies whatever it is given and
  // `get()` parses it back, so an agent that stores a JSON string — as map_property does — leaves
  // a double-encoded value in the column: `"{\"property\":...}"`. Reading the column directly, as
  // this does, therefore sees a quoted string where the agent sees an object. Skipping this step
  // made every binding fall through to the bare-id branch and render its whole JSON blob as the
  // property name.
  if (value.startsWith('"')) {
    try {
      const unwrapped = JSON.parse(value);
      if (typeof unwrapped !== 'string') return undefined;
      value = unwrapped.trim();
      if (value === '') return undefined;
    } catch {
      return undefined;
    }
  }

  if (!value.startsWith('{')) return { property: value };
  try {
    const parsed = JSON.parse(value) as Ga4Binding;
    return parsed?.property ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Just enough of better-sqlite3's surface to read one table — keeps this module testable
 * against a plain stub instead of a real Database handle. */
interface ReadableDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare(sql: string): { all(...params: any[]): any[] };
}

/** `db` is graph.db, already open in the main process (graphService.getDb()). */
export function getWebAnalyticsState(db: ReadableDb | null | undefined): WebAnalyticsState {
  if (!db) return { bindings: {} };
  let rows: Array<{ key: string; value: string }> = [];
  try {
    rows = db.prepare(
      "SELECT key, value FROM agent_state WHERE agent_name = 'web-analytics' AND key LIKE 'ga4Property:%'",
    ).all() as typeof rows;
  } catch {
    // agent_state is created by AgentStateStore on first agent run. Before any agent has ever
    // run it does not exist, and "no bindings" is the honest answer rather than a crashed tab.
    return { bindings: {} };
  }

  const bindings: Record<string, Ga4Binding> = {};
  for (const row of rows) {
    const site = row.key.slice(KEY_PREFIX.length);
    if (!site) continue;
    const binding = parseBinding(row.value);
    // An unbind writes an empty string rather than deleting the row, so an empty value is a
    // deliberate "not bound", not a corrupt one.
    if (binding) bindings[site] = binding;
  }
  return { bindings };
}
