import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const environmentDiffHandler: McpToolHandler = {
  definition: {
    name: 'wpe_environment_diff',
    description:
      'Compare two WP Engine installs side by side — WP version, PHP version, domains, and install settings. ' +
      'Useful for understanding what differs between staging and production.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id_a: {
          type: 'string',
          description: 'First install ID',
        },
        install_id_b: {
          type: 'string',
          description: 'Second install ID',
        },
      },
      required: ['install_id_a', 'install_id_b'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const idA = args.install_id_a as string;
    const idB = args.install_id_b as string;
    if (!idA) return error('install_id_a is required.');
    if (!idB) return error('install_id_b is required.');

    // Fetch both installs and their domains in parallel (4 calls total)
    const [installAResult, installBResult, domainsAResult, domainsBResult] = await Promise.allSettled([
      services.localServices!.capiDirect(`/installs/${idA}`) as Promise<any>,
      services.localServices!.capiDirect(`/installs/${idB}`) as Promise<any>,
      services.localServices!.capiDirect(`/installs/${idA}/domains`) as Promise<any>,
      services.localServices!.capiDirect(`/installs/${idB}/domains`) as Promise<any>,
    ]);

    if (installAResult.status === 'rejected') return capiError(installAResult.reason);
    if (installBResult.status === 'rejected') return capiError(installBResult.reason);

    const a = installAResult.value as any;
    const b = installBResult.value as any;
    const domainsA: any[] = domainsAResult.status === 'fulfilled' ? (domainsAResult.value?.results ?? []) : [];
    const domainsB: any[] = domainsBResult.status === 'fulfilled' ? (domainsBResult.value?.results ?? []) : [];

    const nameA = a?.name ?? idA;
    const nameB = b?.name ?? idB;

    function diff(valA: any, valB: any): string {
      return valA !== valB ? ' ⚠️' : '';
    }

    function fmt(val: any): string {
      return val ?? '—';
    }

    const primaryDomainA = domainsA.find((d) => d.primary)?.name ?? domainsA[0]?.name ?? '—';
    const primaryDomainB = domainsB.find((d) => d.primary)?.name ?? domainsB[0]?.name ?? '—';

    const phpA = a?.php_version ?? null;
    const phpB = b?.php_version ?? null;
    const envA = a?.environment ?? null;
    const envB = b?.environment ?? null;

    const rows: Array<{ attr: string; valA: string; valB: string; flagged: boolean }> = [
      {
        attr: 'Environment type',
        valA: fmt(envA),
        valB: fmt(envB),
        flagged: envA !== envB,
      },
      {
        attr: 'PHP version',
        valA: fmt(phpA),
        valB: fmt(phpB),
        flagged: phpA !== phpB,
      },
      {
        attr: 'Primary domain',
        valA: primaryDomainA,
        valB: primaryDomainB,
        flagged: primaryDomainA !== primaryDomainB,
      },
      {
        attr: 'Domain count',
        valA: String(domainsA.length),
        valB: String(domainsB.length),
        flagged: domainsA.length !== domainsB.length,
      },
      {
        attr: 'Cname',
        valA: fmt(a?.cname),
        valB: fmt(b?.cname),
        flagged: a?.cname !== b?.cname,
      },
    ];

    const lines = [
      `## Environment Diff: ${nameA} vs ${nameB}`,
      '',
      `| Attribute | ${nameA} | ${nameB} | |`,
      `|-----------|${'-'.repeat(nameA.length + 2)}|${'-'.repeat(nameB.length + 2)}|-|`,
    ];

    for (const row of rows) {
      const flag = row.flagged ? '⚠️' : '✅';
      lines.push(`| ${row.attr} | ${row.valA} | ${row.valB} | ${flag} |`);
    }

    // Domain lists for reference
    lines.push('');
    lines.push(`### Domains — ${nameA}`);
    if (domainsAResult.status === 'rejected') {
      lines.push('_Could not fetch domains._');
    } else if (domainsA.length === 0) {
      lines.push('_No domains._');
    } else {
      for (const d of domainsA) {
        lines.push(`- ${d.name ?? d.domain ?? '—'}${d.primary ? ' _(primary)_' : ''}`);
      }
    }

    lines.push('');
    lines.push(`### Domains — ${nameB}`);
    if (domainsBResult.status === 'rejected') {
      lines.push('_Could not fetch domains._');
    } else if (domainsB.length === 0) {
      lines.push('_No domains._');
    } else {
      for (const d of domainsB) {
        lines.push(`- ${d.name ?? d.domain ?? '—'}${d.primary ? ' _(primary)_' : ''}`);
      }
    }

    const diffCount = rows.filter((r) => r.flagged).length;
    lines.push('');
    lines.push('---');
    lines.push(
      diffCount === 0
        ? '✅ No differences detected.'
        : `⚠️ ${diffCount} attribute${diffCount !== 1 ? 's differ' : ' differs'} between the two installs.`,
    );

    return ok(lines.join('\n'));
  },
};
