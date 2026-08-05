import type { WpCliResult } from '../mcp/local-services-bridge';

export type TransportKind = 'local' | 'wpe-ssh' | 'external-ssh' | 'external-rest';

/**
 * Seeded with only the tokens the 15 existing wp-cli tools need. Deliberately
 * NOT exhaustive — Spec 2 enumerates it properly once the REST surface makes the
 * distinctions load-bearing. Do not invent tokens no caller checks.
 */
export type Capability =
  | 'wp-cli'
  | 'arbitrary-options'
  | 'db-query'
  | 'eval'
  | 'search-replace'
  | 'core-update'
  | 'theme-activate';

export type SiteRef =
  | { kind: 'local'; siteId: string; siteName: string }
  | { kind: 'wpe'; installName: string }
  | { kind: 'external'; alias: string };

export interface RunOpts {
  skipPlugins?: boolean;
  skipThemes?: boolean;
  timeoutMs?: number;
}

export interface ProbeResult {
  reachable: boolean;
  wpCliVersion?: string;
  wpVersion?: string;
  detail?: string;
}

export interface DeleteResult {
  success: boolean;
  output: string;
}

export interface SiteTransport {
  readonly kind: TransportKind;
  readonly siteRef: SiteRef;

  /** Never rejects. Failures surface as { success: false }. */
  runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult>;

  /**
   * Delete a file without going through WP-CLI. Exists because WP-CLI loads
   * MU-plugins even with --skip-plugins, so a webshell in mu-plugins/ runs
   * before unlink() and poisons every later command.
   */
  deleteRemoteFile(absolutePath: string): Promise<DeleteResult>;

  supports(cap: Capability): boolean;
  probe(): Promise<ProbeResult>;

  /**
   * Optional: several WP-CLI commands in ONE remote round trip. Only
   * ExternalSshTransport implements this today — Local and WPE transports have
   * no equivalent need for it. Declared here, not just on the concrete class,
   * so withPolicy's wrapper (which returns a fresh object satisfying this
   * interface, not the original instance) can forward it. See policy.ts.
   */
  runWpCliBatch?(commands: string[][]): Promise<(string | null)[]>;
}
