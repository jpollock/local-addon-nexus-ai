/**
 * WP-13c · the ABI preflight, shared by every CLI in this tree.
 *
 * It was born in `sitting.ts` (WP-13b) and lifted here because it is not that
 * harness's property: `run.ts` opens the same real SQLite ledger under the same
 * system Node and used to inherit the bare `NODE_MODULE_VERSION` stack trace
 * this exists to replace. WP-13b recorded the lift as a follow-up; WP-13c is
 * where it landed.
 */

/**
 * better-sqlite3 is built for EITHER Electron OR system Node, never both
 * (CLAUDE.md "Native Modules"). These CLIs run under system Node, so a tree
 * left in the Electron state fails on the first `require` deep inside
 * `initIntelligenceCore` — as a raw stack trace naming a `NODE_MODULE_VERSION`
 * the reader has no reason to connect to `npm run pretest`.
 *
 * Returns a ready-to-print remedy, or null when the binding loads.
 */
export function nativeModuleRemedy(load: () => unknown = () => require('better-sqlite3')): string | null {
  try {
    load();
    return null;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const abi = /NODE_MODULE_VERSION|was compiled against a different Node\.js version/i.test(message);
    return [
      abi
        ? 'better-sqlite3 is built for the WRONG Node ABI — almost certainly for Electron, because'
        : 'better-sqlite3 could not be loaded:',
      abi ? 'this tree was last used to load the addon in Local.' : '',
      '',
      `  ${message.split('\n')[0]}`,
      '',
      'Remedy (this tool runs under SYSTEM Node):',
      '',
      '  npm run pretest',
      '',
      'and afterwards, before loading the addon in Local again:',
      '',
      '  npm run rebuild',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
}
