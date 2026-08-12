/**
 * Navigate Local to the Nexus AI dashboard, where credentials are configured.
 *
 * Local's renderer has no direct router handle for addons; the supported move is its own
 * `sendIPCEvent('goToRoute', …)`, which round-trips through the window's webContents back to the
 * `ipcRenderer.on('goToRoute')` listener in Local's App. `@getflywheel/local` is a host-provided
 * peer (not installed in this repo's node_modules), so it is required lazily — a static import
 * would break the build and every test that renders this tree.
 *
 * This used to open `/settings//nexus-ai`, the addon's page in Local's own preferences.
 * That page was already the wrong destination before it was deleted: the settings home
 * moved into the dashboard, taking the AWS credentials with it, and the button kept
 * sending people to a page that no longer had what they came for. It now opens the
 * dashboard route the sidebar uses.
 *
 * Returns false when the host API is unavailable, so a caller can render the path as text rather
 * than a button that does nothing.
 */
export function openNexusPreferences(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendIPCEvent } = require('@getflywheel/local/renderer');
    if (typeof sendIPCEvent !== 'function') return false;
    sendIPCEvent('goToRoute', '/main/nexus');
    return true;
  } catch {
    return false;
  }
}

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
