/**
 * Data-pipeline observability (plan 2026-08-23).
 *
 * `nexus pipeline status` renders the report the intelligence ledger now
 * keeps: L2/L3 coverage per source, every site whose latest run failed (with
 * the reason), and the last 24 hours of run history. This is the table that
 * previously required hand-written Python over four separate stores.
 */
import { Command } from 'commander';
import { getClient } from '../utils/graphql';

interface LayerRollup {
  ok: number; skip: number; fail: number; never: number; fresh24h: number;
}
interface Report {
  generatedAt: string;
  sources: Array<{ kind: string; total: number; layers: { l2: LayerRollup; l3: LayerRollup } }>;
  failures: Array<{ siteName: string; kind: string; layer: string; reason: string; trigger: string; finishedAt: string }>;
  history24h: { runs: number; ok: number; skip: number; fail: number };
}

const pipelineCommand = new Command('pipeline').description('Data-pipeline status and observability');

pipelineCommand
  .command('status')
  .description('L2/L3 pipeline coverage per source, latest failures with reasons, 24h history')
  .option('--json', 'Output raw JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusPipelineStatus: { success: boolean; error?: string; report?: string } }>(`
        mutation {
          nexusPipelineStatus { success error report }
        }
      `);

      const res = result.nexusPipelineStatus;
      if (!res?.success || !res.report) {
        console.error(`❌ ${res?.error ?? 'No report returned'}`);
        process.exit(1);
      }

      const report: Report = JSON.parse(res.report);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const age = (iso: string): string => {
        const h = (Date.now() - Date.parse(iso)) / 3600_000;
        if (!Number.isFinite(h)) return '?';
        return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
      };

      console.log('\nDATA PIPELINE STATUS');
      console.log('─'.repeat(74));
      console.log(
        `${'source'.padEnd(10)}${'sites'.padStart(6)}   ${'L2 ok/skip/fail/never'.padEnd(24)}${'L3 ok/skip/fail/never'.padEnd(24)}`,
      );
      const order = ['local', 'wpe', 'external'];
      for (const src of [...report.sources].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
        const fmt = (l: LayerRollup) =>
          `${l.ok}/${l.skip}/${l.fail}/${l.never}  (${l.fresh24h} <24h)`;
        console.log(
          `${src.kind.padEnd(10)}${String(src.total).padStart(6)}   ${fmt(src.layers.l2).padEnd(24)}${fmt(src.layers.l3).padEnd(24)}`,
        );
      }

      const h = report.history24h;
      console.log('─'.repeat(74));
      console.log(`last 24h: ${h.runs} runs — ${h.ok} ok, ${h.skip} skipped, ${h.fail} failed`);

      if (report.failures.length > 0) {
        console.log(`\nFAILING (latest run failed) — ${report.failures.length} site×layer:`);
        for (const f of report.failures.slice(0, 25)) {
          console.log(
            `  ${f.siteName.padEnd(20)} ${f.kind.padEnd(9)} ${f.layer.toUpperCase().padEnd(3)} ${age(f.finishedAt).padStart(4)}  ${f.reason.slice(0, 90)}`,
          );
        }
        if (report.failures.length > 25) {
          console.log(`  … and ${report.failures.length - 25} more (use --json for all)`);
        }
      } else {
        console.log('\nNo site has a failing latest run.');
      }
      console.log('');
    } catch (error: any) {
      console.error(`❌ ${error?.message ?? String(error)}`);
      process.exit(1);
    }
  });

export { pipelineCommand };
