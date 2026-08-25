/**
 * Small helpers for agent surfaces that need to send the user somewhere.
 *
 * This module once exported `openNexusPreferences()`, which called Local's own
 * `sendIPCEvent('goToRoute', '/main/nexus')`. It is gone, and nothing may reintroduce it: every
 * one of its five call sites lived *inside* `/main/nexus`, so it asked the host to navigate to the
 * page already on screen. Local re-renders the same route, `NexusOverview` stays mounted with its
 * state untouched, and the button does nothing — silently, with no error to notice. It had drifted
 * there honestly (it used to open `/settings//nexus-ai`, a page that has since been deleted), which
 * is exactly why the shape is worth naming: it stayed compiling and looked alive the whole time.
 *
 * The dashboard is one route. Which tab it shows, and which section Settings opens on, are React
 * state in `NexusOverview` and `SettingsShell` — not addressable by any URL. So a surface deeper in
 * the tree cannot navigate itself there; it takes a callback from the owner of that state
 * (`onOpenSettingsSection`, threaded through `AgentConsoleTab` → `AgentWorkspace`), and when it has
 * none it withholds the button and names the destination in prose instead.
 */

/** Where the credential actually lives, for copy that has to name it. */
export const AWS_CREDENTIAL_LOCATION = 'Nexus AI → Settings → Connections';

/**
 * Open a URL in the user's browser.
 *
 * Used for links Google puts inside its own error messages — an API-enablement console URL is
 * useless as unselectable text in a modal, and retyping a 60-character URL with a project id in it
 * is not a reasonable ask.
 */
export function openExternalUrl(url: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require('electron');
    if (typeof shell?.openExternal !== 'function') return false;
    shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Google reports a disabled API as a long sentence with the console URL embedded. The URL is the
 * fix, so it is pulled out and offered as an action rather than left for the user to transcribe.
 * Returns null for any other error, so callers fall through to their generic handling.
 */
export function parseDisabledGoogleApi(message: string): { api: string; label: string; url: string } | null {
  if (!/has not been used in project|it is disabled/i.test(message)) return null;
  const url = /https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s]+/.exec(message)?.[0];
  if (!url) return null;
  // Trim trailing punctuation the sentence may have left on the URL.
  const clean = url.replace(/[.,)]+$/, '');
  const api = /\/apis\/api\/([^/]+)/.exec(clean)?.[1] ?? '';
  const LABELS: Record<string, string> = {
    'analyticsadmin.googleapis.com': 'Google Analytics Admin API',
    'analyticsdata.googleapis.com': 'Google Analytics Data API',
  };
  return { api, label: LABELS[api] ?? api, url: clean };
}
