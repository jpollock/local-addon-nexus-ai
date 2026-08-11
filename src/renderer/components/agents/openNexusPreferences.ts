/**
 * Navigate Local to Preferences → Nexus AI, where the AWS access key lives.
 *
 * Local's renderer has no direct router handle for addons; the supported move is its own
 * `sendIPCEvent('goToRoute', …)`, which round-trips through the window's webContents back to the
 * `ipcRenderer.on('goToRoute')` listener in Local's App. `@getflywheel/local` is a host-provided
 * peer (not installed in this repo's node_modules), so it is required lazily — a static import
 * would break the build and every test that renders this tree.
 *
 * The double slash in the route is not a typo. Local builds addon preference routes as
 * `/settings/${menuItem.path}` and this addon registers `path: '/nexus-ai'`, so `/settings//nexus-ai`
 * is the literal string Local's own sidebar NavLink and RoutePlus both use.
 *
 * Returns false when the host API is unavailable, so a caller can render the path as text rather
 * than a button that does nothing.
 */
export function openNexusPreferences(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendIPCEvent } = require('@getflywheel/local/renderer');
    if (typeof sendIPCEvent !== 'function') return false;
    sendIPCEvent('goToRoute', '/settings//nexus-ai');
    return true;
  } catch {
    return false;
  }
}

/** Where the credential actually lives, for copy that has to name it. */
export const AWS_CREDENTIAL_LOCATION = 'Preferences → Nexus AI → AWS S3 Credentials';

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
