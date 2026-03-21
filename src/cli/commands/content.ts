/**
 * Content & Context Commands
 *
 * Code analysis, documentation, and context queries.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const contentCommand = new Command('content').description('Content and context management');

// ============================================================================
// Search Commands
// ============================================================================

contentCommand
  .command('search <target> <query>')
  .description('Search content within a site')
  .option('--limit <n>', 'Max results', '10')
  .option('--json', 'Output as JSON')
  .action(async (target, query, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusContentSearch: any }>(`
        mutation($target: String!, $query: String!, $limit: Int) {
          nexusContentSearch(target: $target, query: $query, limit: $limit) {
            success
            error
            results {
              path
              type
              score
              snippet
              lineNumber
            }
          }
        }
      `, { target, query, limit: parseInt(options.limit, 10) });

      const { success, error, results } = result.nexusContentSearch;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(`\nSearch Results: "${query}" in ${target}`);
      console.log('─'.repeat(50));

      if (results.length === 0) {
        console.log('  No results found');
      } else {
        for (const r of results) {
          console.log(`  ${r.path}${r.lineNumber ? `:${r.lineNumber}` : ''}`);
          console.log(`    Type: ${r.type} | Score: ${r.score.toFixed(2)}`);
          console.log(`    ${r.snippet}`);
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

contentCommand
  .command('search-all <query>')
  .description('Search content across all sites')
  .option('--limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusContentSearchAll: any }>(`
        mutation($query: String!, $limit: Int) {
          nexusContentSearchAll(query: $query, limit: $limit) {
            success
            error
            results {
              target
              siteName
              path
              type
              score
              snippet
            }
          }
        }
      `, { query, limit: parseInt(options.limit, 10) });

      const { success, error, results } = result.nexusContentSearchAll;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(`\nCross-Site Search: "${query}"`);
      console.log('─'.repeat(50));

      if (results.length === 0) {
        console.log('  No results found');
      } else {
        for (const r of results) {
          console.log(`  ${r.siteName}: ${r.path}`);
          console.log(`    Type: ${r.type} | Score: ${r.score.toFixed(2)}`);
          console.log(`    ${r.snippet}`);
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Site Structure & Analysis Commands
// ============================================================================

contentCommand
  .command('structure <target>')
  .description('Get site file structure')
  .option('--json', 'Output as JSON')
  .option('--depth <n>', 'Max depth', '3')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusContentStructure: any }>(`
        mutation($target: String!, $depth: Int) {
          nexusContentStructure(target: $target, depth: $depth) {
            success
            error
            structure {
              path
              type
              fileCount
              children {
                path
                type
                size
              }
            }
          }
        }
      `, { target, depth: parseInt(options.depth, 10) });

      const { success, error, structure } = result.nexusContentStructure;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(structure, null, 2));
        return;
      }

      console.log(`\nSite Structure: ${target}`);
      console.log('─'.repeat(50));
      console.log(`Path: ${structure.path}`);
      console.log(`Type: ${structure.type}`);
      console.log(`Files: ${structure.fileCount}`);

      if (structure.children && structure.children.length > 0) {
        console.log('\nContents:');
        for (const child of structure.children) {
          const sizeStr = child.size ? ` (${(child.size / 1024).toFixed(1)} KB)` : '';
          const typeIcon = child.type === 'directory' ? '📁' : '📄';
          console.log(`  ${typeIcon} ${child.path}${sizeStr}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Index Management Commands
// ============================================================================

contentCommand
  .command('index-status <target>')
  .description('Get indexing status for a site')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusContentIndexStatus: any }>(`
        mutation($target: String!) {
          nexusContentIndexStatus(target: $target) {
            success
            error
            status {
              state
              documentCount
              chunkCount
              lastIndexed
              indexedAt
              errorMessage
            }
          }
        }
      `, { target });

      const { success, error, status } = result.nexusContentIndexStatus;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      const stateIcon = status.state === 'indexed' ? '✅' : status.state === 'indexing' ? '⏳' : '⚫';

      console.log(`\nIndex Status: ${target}`);
      console.log('─'.repeat(50));
      console.log(`State:         ${stateIcon} ${status.state}`);
      console.log(`Documents:     ${status.documentCount}`);
      console.log(`Chunks:        ${status.chunkCount}`);
      if (status.lastIndexed) {
        console.log(`Last Indexed:  ${new Date(status.lastIndexed).toLocaleString()}`);
      }
      if (status.errorMessage) {
        console.log(`Error:         ${status.errorMessage}`);
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

contentCommand
  .command('list-indexed')
  .description('List all indexed sites')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusContentListIndexed: any }>(`
        mutation {
          nexusContentListIndexed {
            success
            error
            sites {
              target
              siteName
              state
              documentCount
              chunkCount
              lastIndexed
            }
          }
        }
      `, {});

      const { success, error, sites } = result.nexusContentListIndexed;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(sites, null, 2));
        return;
      }

      console.log(`\nIndexed Sites (${sites.length})`);
      console.log('─'.repeat(50));

      if (sites.length === 0) {
        console.log('  No indexed sites');
      } else {
        for (const site of sites) {
          const stateIcon = site.state === 'indexed' ? '✅' : site.state === 'indexing' ? '⏳' : '⚫';
          console.log(`  ${stateIcon} ${site.siteName}`);
          console.log(`     Documents: ${site.documentCount}, Chunks: ${site.chunkCount}`);
          if (site.lastIndexed) {
            console.log(`     Last indexed: ${new Date(site.lastIndexed).toLocaleString()}`);
          }
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

contentCommand
  .command('reindex <target>')
  .description('Reindex a site')
  .action(async (target) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 600000 }); // 10 min for indexing

      console.log(`\nReindexing ${target}...`);

      const result = await client.mutate<{ nexusContentReindex: any }>(`
        mutation($target: String!) {
          nexusContentReindex(target: $target) {
            success
            error
            documentCount
            chunkCount
          }
        }
      `, { target });

      const { success, error, documentCount, chunkCount } = result.nexusContentReindex;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Reindex complete`);
      console.log(`   Documents: ${documentCount}`);
      console.log(`   Chunks: ${chunkCount}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { contentCommand };
