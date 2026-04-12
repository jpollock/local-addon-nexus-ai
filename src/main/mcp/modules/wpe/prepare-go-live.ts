import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const prepareGoLiveHandler: McpToolHandler = {
  definition: {
    name: 'wpe_prepare_go_live',
    description:
      'Automated go-live preparation for a WP Engine install — adds the domain, sets it as primary, optionally configures www redirect, requests SSL certificate, and purges cache. Tier 2 (modifying) — confirms the intended changes before proceeding. Prerequisites: DNS must be pointing to WPE. Run wpe_go_live_checklist first to verify readiness. After completion, use wpe_diagnose_site to confirm everything is working.' +
      'optionally adds www redirect, requests SSL, and purges cache. Tier 2 (modifying).',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: {
          type: 'string',
          description: 'WP Engine install ID',
        },
        primary_domain: {
          type: 'string',
          description: 'The primary domain to configure (e.g. example.com)',
        },
        redirect_www: {
          type: 'boolean',
          description: 'Also add www.primary_domain and redirect to primary. Default: true',
        },
      },
      required: ['install_id', 'primary_domain'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const installId = args.install_id as string;
    const primaryDomain = args.primary_domain as string;
    const redirectWww = args.redirect_www !== false;

    if (!installId) return error('install_id is required.');
    if (!primaryDomain) return error('primary_domain is required.');

    const wwwDomain = `www.${primaryDomain}`;
    const steps: Array<{ label: string; icon: string; detail: string }> = [];

    function stepOk(label: string, detail: string) {
      steps.push({ label, icon: '✅', detail });
    }
    function stepWarn(label: string, detail: string) {
      steps.push({ label, icon: '⚠️', detail });
    }
    function stepFail(label: string, detail: string) {
      steps.push({ label, icon: '❌', detail });
    }

    // Step 1: Get existing domains
    let existingDomains: any[] = [];
    try {
      const domainsData = await services.localServices!.capiDirect(
        `/installs/${installId}/domains`,
      ) as any;
      existingDomains = domainsData?.results ?? [];
    } catch (err: any) {
      stepFail('Fetch existing domains', err.message ?? String(err));
      return ok(buildReport(installId, primaryDomain, steps));
    }

    // Step 2: Add primary domain if not already present
    let primaryDomainId: string | null = null;
    const existingPrimary = existingDomains.find(
      (d) => (d.name ?? d.domain ?? '').toLowerCase() === primaryDomain.toLowerCase(),
    );

    if (existingPrimary) {
      primaryDomainId = existingPrimary.id;
      stepOk('Add primary domain', `\`${primaryDomain}\` already exists (ID: ${primaryDomainId}).`);
    } else {
      try {
        const addResult = await services.localServices!.capiDirect(
          `/installs/${installId}/domains`,
          'POST',
          { name: primaryDomain },
        ) as any;
        primaryDomainId = addResult?.id ?? null;
        stepOk('Add primary domain', `\`${primaryDomain}\` added (ID: ${primaryDomainId ?? 'unknown'}).`);
      } catch (err: any) {
        stepFail('Add primary domain', err.message ?? String(err));
        return ok(buildReport(installId, primaryDomain, steps));
      }
    }

    // Step 3: Set domain as primary
    if (primaryDomainId) {
      try {
        await services.localServices!.capiDirect(
          `/installs/${installId}/domains/${primaryDomainId}`,
          'PATCH',
          { primary: true },
        );
        stepOk('Set as primary domain', `\`${primaryDomain}\` is now the primary domain.`);
      } catch (err: any) {
        stepWarn('Set as primary domain', `Could not set as primary: ${err.message ?? String(err)}`);
      }
    }

    // Step 4: Add www redirect if requested
    if (redirectWww) {
      const existingWww = existingDomains.find(
        (d) => (d.name ?? d.domain ?? '').toLowerCase() === wwwDomain.toLowerCase(),
      );

      if (existingWww) {
        stepOk('Add www redirect', `\`${wwwDomain}\` already exists.`);
      } else {
        try {
          await services.localServices!.capiDirect(
            `/installs/${installId}/domains`,
            'POST',
            { name: wwwDomain },
          );
          stepOk('Add www redirect', `\`${wwwDomain}\` added.`);
        } catch (err: any) {
          stepWarn('Add www redirect', `Could not add ${wwwDomain}: ${err.message ?? String(err)}`);
        }
      }
    }

    // Step 5: Request SSL certificate
    if (primaryDomainId) {
      try {
        await services.localServices!.capiDirect(
          `/installs/${installId}/ssl_certificates`,
          'POST',
          { domain_ids: [primaryDomainId] },
        );
        stepOk('Request SSL certificate', `SSL requested for \`${primaryDomain}\`. May take a few minutes to provision.`);
      } catch (err: any) {
        stepWarn('Request SSL certificate', `Could not request SSL: ${err.message ?? String(err)}`);
      }
    }

    // Step 6: Purge cache
    try {
      await services.localServices!.capiDirect(
        `/installs/${installId}/purge_cache`,
        'POST',
        {},
      );
      stepOk('Purge cache', 'Cache purged successfully.');
    } catch (err: any) {
      stepWarn('Purge cache', `Cache purge failed: ${err.message ?? String(err)}`);
    }

    return ok(buildReport(installId, primaryDomain, steps));
  },
};

function buildReport(
  installId: string,
  primaryDomain: string,
  steps: Array<{ label: string; icon: string; detail: string }>,
): string {
  const lines = [
    `## Go-Live Preparation: ${primaryDomain}`,
    `**Install ID:** ${installId}`,
    '',
    '### Steps Taken',
    '',
  ];

  for (const step of steps) {
    lines.push(`${step.icon} **${step.label}** — ${step.detail}`);
  }

  const failCount = steps.filter((s) => s.icon === '❌').length;
  const warnCount = steps.filter((s) => s.icon === '⚠️').length;

  lines.push('');
  lines.push('---');
  if (failCount > 0) {
    lines.push(`${failCount} step(s) failed. Review the errors above and retry or take action manually.`);
  } else if (warnCount > 0) {
    lines.push(`Completed with ${warnCount} warning(s). Review above for details.`);
  } else {
    lines.push('All steps completed successfully. Run **wpe_go_live_checklist** to verify DNS and SSL status.');
  }

  return lines.join('\n');
}
