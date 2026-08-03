/**
 * The single target parser. Replaces three copies that had already skewed:
 * the CLI stored regex group 2 as `installId`, both server copies as
 * `installName`. The unified shape uses `installName`.
 *
 * `verboseErrors` preserves the CLI's richer messages without imposing them
 * on GraphQL callers, whose error text is user-visible.
 */

export type TargetEnvironment = 'production' | 'staging' | 'development';

export interface ParsedTarget {
  type: 'local' | 'wpe';
  original: string;
  siteName?: string;
  account?: string;
  /** For WPE: the install portion. May contain slashes (the regex is lazy). */
  installName?: string;
  environment?: TargetEnvironment;
}

export interface ParseTargetOptions {
  /** CLI passes true for actionable multi-line errors; servers keep terse legacy text. */
  verboseErrors?: boolean;
}

const ENVIRONMENTS: readonly string[] = ['production', 'staging', 'development'];

export function parseTarget(target: string, opts: ParseTargetOptions = {}): ParsedTarget {
  const verbose = opts.verboseErrors ?? false;

  if (target.endsWith('@local')) {
    return { type: 'local', original: target, siteName: target.replace('@local', '') };
  }

  const wpeMatch = target.match(/^wpe:(.+?)\/(.+?)@(production|staging|development)$/);
  if (wpeMatch) {
    return {
      type: 'wpe',
      original: target,
      account: wpeMatch[1],
      installName: wpeMatch[2],
      environment: wpeMatch[3] as TargetEnvironment,
    };
  }

  if (target.startsWith('wpe:')) {
    throw new Error(
      verbose
        ? `Incomplete WPE target: ${target}\n\n` +
          `Expected: wpe:account/install@environment\n` +
          `Environments: production, staging, development`
        : `Incomplete WPE target: ${target}. Expected wpe:account/install@environment`,
    );
  }

  if (!target.includes('@')) {
    return { type: 'local', original: target, siteName: target };
  }

  if (verbose) {
    const [siteName, env] = target.split('@');
    if (ENVIRONMENTS.includes(env)) {
      throw new Error(
        `Shorthand syntax '${target}' requires a link.\n\n` +
          `Site '${siteName}' is not linked to environment '${env}'.\n` +
          `Use full syntax: wpe:account/install@${env}\n` +
          `Or create link: nexus sync pull ${siteName}@local --from=wpe:account/install@${env}`,
      );
    }
  }

  throw new Error(
    verbose
      ? `Invalid target syntax: ${target}\n\n` +
        `Expected formats:\n` +
        `  Plain:  mysite\n` +
        `  Local:  mysite@local\n` +
        `  WPE:    wpe:account/install@environment\n\n` +
        `Environments: production, staging, development`
      : `Invalid target syntax: ${target}. Expected 'mysite', 'mysite@local', or 'wpe:account/install@environment'`,
  );
}

export function requireLocalTarget(target: string, opts?: ParseTargetOptions): string {
  const parsed = parseTarget(target, opts);
  if (parsed.type !== 'local') {
    throw new Error(`Expected local target (e.g., mysite@local), got: ${target}`);
  }
  return parsed.siteName!;
}

export function requireWpeTarget(target: string, opts?: ParseTargetOptions): {
  account: string;
  installName: string;
  /** @deprecated Alias of installName, kept so existing CLI call sites need no change. */
  installId: string;
  environment: string;
} {
  const parsed = parseTarget(target, opts);
  if (parsed.type !== 'wpe') {
    throw new Error(`Expected WPE target (e.g., wpe:account/install@production), got: ${target}`);
  }
  return {
    account: parsed.account!,
    installName: parsed.installName!,
    installId: parsed.installName!,
    environment: parsed.environment!,
  };
}

export function formatTarget(parsed: ParsedTarget): string {
  if (parsed.type === 'local') return `${parsed.siteName}@local`;
  return `wpe:${parsed.account}/${parsed.installName}@${parsed.environment}`;
}
