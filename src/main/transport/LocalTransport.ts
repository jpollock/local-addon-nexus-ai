import type { LocalServicesBridge, WpCliResult } from '../mcp/local-services-bridge';
import type {
  Capability, DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';

export class LocalTransport implements SiteTransport {
  readonly kind: TransportKind = 'local';
  readonly siteRef: SiteRef;

  constructor(
    private readonly siteId: string,
    siteName: string,
    private readonly localServices: LocalServicesBridge,
  ) {
    this.siteRef = { kind: 'local', siteId, siteName };
  }

  supports(_cap: Capability): boolean {
    return true;
  }

  runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult> {
    return opts === undefined
      ? this.localServices.wpCliRun(this.siteId, args)
      : this.localServices.wpCliRun(this.siteId, args, opts as any);
  }

  /**
   * Local sites have no remote filesystem. Sentinel's raw-delete path is
   * WPE-only; this exists to satisfy the interface, not to be called.
   */
  async deleteRemoteFile(absolutePath: string): Promise<DeleteResult> {
    return {
      success: false,
      output: `deleteRemoteFile is not supported on local sites (path: ${absolutePath})`,
    };
  }

  async probe(): Promise<ProbeResult> {
    const res = await this.runWpCli(['cli', 'version']);
    return res.success
      ? { reachable: true, wpCliVersion: (res.stdout ?? '').trim() }
      : { reachable: false, detail: res.stdout ?? undefined };
  }
}
