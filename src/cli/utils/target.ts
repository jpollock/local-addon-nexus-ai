/**
 * Target Parsing Utilities
 *
 * Parses site targeting syntax:
 * - Local: mysite@local
 * - WPE: wpe:account/installid@environment
 * - Linked: mysite@production (requires link lookup, not handled here)
 */

export interface ParsedTarget {
  type: 'local' | 'wpe';
  original: string;

  // Local fields
  siteName?: string;

  // WPE fields
  account?: string;
  installId?: string;
  environment?: 'production' | 'staging' | 'development';
}

export function parseTarget(target: string): ParsedTarget {
  // Local: mysite@local
  if (target.endsWith('@local')) {
    return {
      type: 'local',
      original: target,
      siteName: target.replace('@local', ''),
    };
  }

  // WPE: wpe:account/installid@environment
  const wpeMatch = target.match(/^wpe:(.+?)\/(.+?)@(production|staging|development)$/);
  if (wpeMatch) {
    return {
      type: 'wpe',
      original: target,
      account: wpeMatch[1],
      installId: wpeMatch[2],
      environment: wpeMatch[3] as 'production' | 'staging' | 'development',
    };
  }

  // Incomplete WPE target (starts with wpe: but missing @environment)
  if (target.startsWith('wpe:')) {
    throw new Error(
      `Incomplete WPE target: ${target}\n\n` +
        `Expected: wpe:account/install@environment\n` +
        `Environments: production, staging, development`
    );
  }

  // Plain name (no @) — resolve at the server level (local first, then WPE graph)
  if (!target.includes('@')) {
    return {
      type: 'local',
      original: target,
      siteName: target,
    };
  }

  // Check if it's a shorthand attempt (mysite@production)
  if (target.includes('@')) {
    const [siteName, env] = target.split('@');
    if (['production', 'staging', 'development'].includes(env)) {
      throw new Error(
        `Shorthand syntax '${target}' requires a link.\n\n` +
          `Site '${siteName}' is not linked to environment '${env}'.\n` +
          `Use full syntax: wpe:account/install@${env}\n` +
          `Or create link: nexus sync pull ${siteName}@local --from=wpe:account/install@${env}`
      );
    }
  }

  throw new Error(
    `Invalid target syntax: ${target}\n\n` +
      `Expected formats:\n` +
      `  Plain:  mysite\n` +
      `  Local:  mysite@local\n` +
      `  WPE:    wpe:account/install@environment\n\n` +
      `Environments: production, staging, development`
  );
}

/**
 * Validate that target is local
 */
export function requireLocalTarget(target: string): string {
  const parsed = parseTarget(target);
  if (parsed.type !== 'local') {
    throw new Error(
      `Expected local target (e.g., mysite@local), got: ${target}`
    );
  }
  return parsed.siteName!;
}

/**
 * Validate that target is WPE
 */
export function requireWpeTarget(target: string): {
  account: string;
  installId: string;
  environment: string;
} {
  const parsed = parseTarget(target);
  if (parsed.type !== 'wpe') {
    throw new Error(
      `Expected WPE target (e.g., wpe:account/install@production), got: ${target}`
    );
  }
  return {
    account: parsed.account!,
    installId: parsed.installId!,
    environment: parsed.environment!,
  };
}

/**
 * Format target for display
 */
export function formatTarget(parsed: ParsedTarget): string {
  if (parsed.type === 'local') {
    return `${parsed.siteName}@local`;
  }
  return `wpe:${parsed.account}/${parsed.installId}@${parsed.environment}`;
}
