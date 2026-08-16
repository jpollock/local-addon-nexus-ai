/**
 * nexus_pairing_proposals — WP-07's gap-filler beside the nexus_link_site flow.
 *
 * Governing decision: docs/intelligence/reconciliation-entity-identity.md §4.
 * Track 1 owns linking and already built the human-in-the-loop surface
 * (nexus_link_site); the entity service only supplies CANDIDATES for the
 * sites Track 1 could not attach. So this tool:
 *   - runs proposePairings() ONLY over the resolver's unresolved report;
 *   - renders each proposal with its evidence and the exact nexus_link_site
 *     call that would accept it;
 *   - writes nothing, ever. A proposal is information; linking is a human act
 *     through Track-1's surface.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { provisionalEnvironmentId } from '../../../intelligence-host/provisionalEntity';

interface UnresolvedSiteLike {
  localSiteId: string;
  localSiteName: string;
}

export const pairingProposalsHandler: McpToolHandler = {
  definition: {
    name: 'nexus_pairing_proposals',
    description:
      'Suggest which WP Engine install each UNRESOLVED local site (see nexus_fleet_list) might ' +
      'belong to, from ledger evidence — shared domains (strong) or environment-style name pairs ' +
      '(weak). Proposals are information only and carry their evidence and confidence; nothing is ' +
      'ever linked automatically. To accept one, run the nexus_link_site call each proposal spells ' +
      'out. Sites Track-1 already resolved are never re-proposed.',
    inputSchema: { type: 'object', properties: {} },
    isAvailable: (services) => !!services.siteLinkResolver,
    annotations: { readOnlyHint: true },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const core = getIntelligenceCore();
    if (!core?.entities) {
      return error(
        'Intelligence ledger unavailable — pairing proposals need the entity service. ' +
          'Manual linking via nexus_link_site still works.',
      );
    }

    const unresolved: UnresolvedSiteLike[] =
      services.siteLinkResolver?.getLastReport()?.unresolved ?? [];
    if (unresolved.length === 0) {
      return ok(
        'No unresolved local sites — nothing to propose. ' +
          '(Proposals exist only for sites automatic resolution could not attach; ' +
          'see nexus_fleet_list for the current link state.)',
      );
    }

    // The unresolved report speaks local site ids; twins key by the derived
    // env entity id. Pure derivation — a read surface must not ensure().
    const localSiteByEntity = new Map(
      unresolved.map((s) => [provisionalEnvironmentId(s.localSiteId), s] as const),
    );

    // Map WPE env entities back to install ids so a proposal can name the
    // exact nexus_link_site acceptance call. Best-effort: without the graph
    // the proposals still render, just without a ready-made call.
    const installByEntity = new Map<string, { installId: string; name: string }>();
    try {
      const db = services.graphService?.getDb?.();
      if (db) {
        const rows = db
          .prepare(
            // This keys on remote_install_id to spell out nexus_link_site
            // calls, and site_links attaches local sandboxes to WPE installs
            // only. Proposals themselves span every source.
            `SELECT id, name, remote_install_id FROM sites
             WHERE source = 'wpe' AND is_active = 1 -- wpe-by-nature: nexus_link_site targets WPE installs only`,
          )
          .all() as Array<{ id: string; name: string; remote_install_id: string | null }>;
        for (const row of rows) {
          // FleetAssembler addresses installs by remote_install_id ?? id.
          installByEntity.set(provisionalEnvironmentId(row.id), {
            installId: row.remote_install_id ?? row.id,
            name: row.name,
          });
        }
      }
    } catch {
      /* proposals degrade to evidence-only rendering */
    }

    const proposals = core.entities.proposePairings([...localSiteByEntity.keys()]);

    const lines: string[] = [`## Pairing proposals — ${unresolved.length} unresolved local site(s)`];
    if (proposals.length === 0) {
      lines.push(
        '',
        'No candidates found in the ledger for the unresolved sites. ' +
          'They can still be linked manually with nexus_link_site (install ids: nexus_fleet_list).',
      );
      return ok(lines.join('\n'));
    }

    for (const p of proposals) {
      const localSide =
        localSiteByEntity.get(p.entityA) ?? localSiteByEntity.get(p.entityB);
      const counterpartEntity = localSiteByEntity.has(p.entityA) ? p.entityB : p.entityA;
      const install = installByEntity.get(counterpartEntity);

      lines.push('', `- **${p.siteAName}** ↔ **${p.siteBName}**`);
      lines.push(`  evidence: ${p.evidence} (confidence ${p.confidence}) — ${p.detail}`);
      if (localSide && install) {
        lines.push(
          `  accept with: nexus_link_site {"site": "${localSide.localSiteId}", "install_id": "${install.installId}"}`,
        );
      } else {
        lines.push('  counterpart is not a known WPE install — no link call to offer.');
      }
    }

    lines.push(
      '',
      '_Proposals are information only — nothing has been linked. Accepting one is a human act ' +
        'through nexus_link_site, and a link made there is authoritative._',
    );
    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
