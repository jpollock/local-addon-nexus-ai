import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IwConnectionStatus, IwSiteBinding } from '../../../../common/types';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { LocalServicesBridge } from '../../local-services-bridge';
import type { RegistryStorage } from '../../../content/IndexRegistry';

const PIS_URL = 'https://wp-product-info.wpesvc.net/v1/plugins/wpe-hub';

/** Filesystem check only — never WP-CLI (races MySQL on siteStarted). */
export function detectHubPlugin(webRoot: string): boolean {
  return fs.existsSync(path.join(webRoot, 'wp-content', 'plugins', 'wpe-hub'));
}

/**
 * Install and activate the Hub Plugin from the WPE Product Info Service.
 *
 * Downloads the zip in Node.js (bypasses WordPress's WP_HTTP_BLOCK_EXTERNAL
 * restriction on production-cloned sites), saves it to a temp file, then
 * installs from the local path via wp plugin install.
 */
export async function installHubPlugin(
  siteId: string,
  localServices: LocalServicesBridge,
): Promise<{ ok: boolean; error?: string }> {
  // Step 1: Fetch PIS metadata to get the signed download URL
  let downloadUrl: string;
  try {
    const res = await fetch(PIS_URL);
    if (!res.ok) throw new Error(`PIS returned ${res.status}`);
    const meta = await res.json() as { download_link?: string; package?: string };
    downloadUrl = meta.download_link ?? meta.package ?? '';
    if (!downloadUrl) throw new Error('PIS response missing download_link');
  } catch (err: any) {
    return { ok: false, error: `Failed to fetch Hub Plugin from PIS: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 2: Download the zip in Node.js — avoids WP_HTTP_BLOCK_EXTERNAL on
  // production-cloned sites where WordPress itself can't make external requests.
  const tmpZip = path.join(os.tmpdir(), 'wpe-hub-install.zip');
  try {
    const zipRes = await fetch(downloadUrl);
    if (!zipRes.ok) throw new Error(`Download returned ${zipRes.status}`);
    const buf = await zipRes.arrayBuffer();
    fs.writeFileSync(tmpZip, Buffer.from(buf));
  } catch (err: any) {
    return { ok: false, error: `Failed to download Hub Plugin: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 3: Install from local path via WP-CLI
  try {
    const result = await localServices.wpCliRun(siteId, ['plugin', 'install', tmpZip, '--activate']);
    const errText = result.stderr ?? result.stdout ?? '';

    if (!result.success || (result.exitCode != null && result.exitCode !== 0)) {
      if (errText.toLowerCase().includes('openssl')) {
        return {
          ok: false,
          error: 'Hub Plugin requires the PHP OpenSSL extension. Enable it in your PHP configuration and try again.',
        };
      }
      return { ok: false, error: errText || 'Plugin install failed' };
    }

    return { ok: true };
  } finally {
    // Clean up temp file regardless of outcome
    try { fs.unlinkSync(tmpZip); } catch { /* best-effort */ }
  }
}

// PHP snippet run via `wp eval` to read all relevant auth options in one call.
const STATUS_PHP = `
$d = [
  'registered' => get_option('wpe_auth_registered', ''),
  'client_id'  => get_option('wpe_auth_client_id', ''),
  'project_id' => get_option('wpe_auth_project_id', ''),
  'account_id' => get_option('wpe_auth_account_id', ''),
  'copy_reset' => get_option('wpe_auth_copy_detected', ''),
];
echo json_encode($d);
`;

/** Read IW connection state from the site's wp_options via wp eval. Site must be running. */
export async function getConnectionStatus(
  siteId: string,
  localServices: LocalServicesBridge,
): Promise<IwConnectionStatus> {
  const site = localServices.resolveSiteObject(siteId) as any;
  const webRoot: string = site?.paths?.webRoot ?? '';
  const hubInstalled = webRoot ? detectHubPlugin(webRoot) : false;

  if (!hubInstalled) {
    return { hubInstalled: false, connected: false, copyReset: false, clientId: null, projectId: null, accountId: null };
  }

  try {
    const result = await localServices.wpCliRun(siteId, ['eval', STATUS_PHP]);
    const raw = JSON.parse((result.stdout ?? '').trim()) as Record<string, string>;
    const registered = Boolean(raw.registered);
    const clientId = raw.client_id || null;
    const copyReset = Boolean(raw.copy_reset);
    const connected = !copyReset && registered && !!clientId;
    return {
      hubInstalled: true,
      connected,
      copyReset,
      clientId: connected ? clientId : null,
      projectId: raw.project_id || null,
      accountId: raw.account_id || null,
    };
  } catch {
    return { hubInstalled: true, connected: false, copyReset: false, clientId: null, projectId: null, accountId: null };
  }
}

// ─── Binding persistence ──────────────────────────────────────────────────────

export function readIwBinding(siteId: string, storage: RegistryStorage): IwSiteBinding | null {
  const all = (storage.get(STORAGE_KEYS.IW_SITE_BINDINGS) ?? {}) as Record<string, IwSiteBinding>;
  return all[siteId] ?? null;
}

export function writeIwBinding(binding: IwSiteBinding, storage: RegistryStorage): void {
  const all = (storage.get(STORAGE_KEYS.IW_SITE_BINDINGS) ?? {}) as Record<string, IwSiteBinding>;
  storage.set(STORAGE_KEYS.IW_SITE_BINDINGS, { ...all, [binding.siteId]: binding });
}

export function clearIwBinding(siteId: string, storage: RegistryStorage): void {
  const all = (storage.get(STORAGE_KEYS.IW_SITE_BINDINGS) ?? {}) as Record<string, IwSiteBinding>;
  const { [siteId]: _removed, ...rest } = all;
  storage.set(STORAGE_KEYS.IW_SITE_BINDINGS, rest);
}
