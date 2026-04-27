/**
 * Gateway Commands
 *
 * AI gateway usage and cost reporting.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';

const gatewayCommand = new Command('gateway').description('AI gateway usage and cost reporting');

gatewayCommand
  .command('usage')
  .description('Show AI gateway spend by site and model')
  .option('--month <YYYY-MM>', 'Month to report (default: current month)')
  .option('--site <name>', 'Filter to a specific site')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusGatewayUsage: any }>(`
        mutation($month: String, $siteId: String) {
          nexusGatewayUsage(month: $month, siteId: $siteId) {
            success
            error
            month
            totalCost
            totalRequests
            totalTokens
            bySite {
              siteId
              siteName
              totalCost
              totalRequests
              totalTokens
            }
            byModel {
              model
              totalCost
              totalRequests
              totalTokens
            }
          }
        }
      `, { month: options.month ?? null, siteId: options.site ?? null });

      const data = result.nexusGatewayUsage;

      if (!data.success) {
        console.error(`\n❌ ${data.error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.totalRequests === 0) {
        console.log(`\nNo AI gateway usage recorded for ${data.month}.`);
        console.log('Gateway usage is tracked when WordPress sites make AI requests through the Local AI Gateway.\n');
        return;
      }

      console.log(`\nAI Gateway Usage — ${data.month}`);
      console.log('─'.repeat(50));
      console.log(`Total: $${data.totalCost.toFixed(4)} · ${data.totalRequests} requests · ${(data.totalTokens / 1000).toFixed(1)}k tokens\n`);

      if (data.bySite.length > 0) {
        console.log('By site:');
        for (const site of data.bySite) {
          const pct = data.totalCost > 0 ? Math.round((site.totalCost / data.totalCost) * 100) : 0;
          console.log(`  ${site.siteName.padEnd(30)} $${site.totalCost.toFixed(4)}  ${pct}%  (${site.totalRequests} req)`);
        }
        console.log('');
      }

      if (data.byModel.length > 0) {
        console.log('By model:');
        for (const m of data.byModel) {
          console.log(`  ${m.model.padEnd(30)} $${m.totalCost.toFixed(4)}  (${m.totalRequests} req)`);
        }
        console.log('');
      }
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

export { gatewayCommand };
