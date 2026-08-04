/**
 * The CLI and MCP surfaces were unified onto one policy, one router, one
 * classifier. This suite asserts that a command's outcome depends on the
 * target and the command, never on which surface asked. If they drift apart
 * again, one of these properties fails.
 */

import { REMOTE_POLICY, checkCommand } from '../../../src/main/transport/policy';
import { classifyWpCliOp } from '../../../src/main/transport/classify';
import { isOperationAllowed, DEFAULT_OPERATION_PERMISSIONS } from '../../../src/main/mcp/utils/operation-permissions';

/** Every argv shape the CLI sends, from docs/wp-cli-surface-matrix.md §2. */
const CLI_COMMANDS: string[][] = [
  ['plugin','list'], ['plugin','install','x'], ['plugin','activate','x'],
  ['plugin','deactivate','x'], ['plugin','update','x'],
  ['theme','list'], ['theme','activate','x'],
  ['core','version'], ['core','update'],
  ['db','export'], ['db','import','f.sql'],
  ['search-replace','a','b'],
  ['post','create'], ['post','update','1'], ['post','delete','1'],
  ['user','list'], ['option','get','siteurl'], ['site','health'],
];

/**
 * Expected classification for each command. Reads are in WPCLI_READ_COMMANDS
 * (classify.ts:2-12); everything else fails closed to 'wpcli'.
 * A misclassification silently opens a write on production, so these must be pinned.
 */
const COMMAND_CLASSIFICATIONS: Array<[string[], 'wpcli_read' | 'wpcli']> = [
  [['plugin','list'], 'wpcli_read'],
  [['plugin','install','x'], 'wpcli'],
  [['plugin','activate','x'], 'wpcli'],
  [['plugin','deactivate','x'], 'wpcli'],
  [['plugin','update','x'], 'wpcli'],
  [['theme','list'], 'wpcli_read'],
  [['theme','activate','x'], 'wpcli'],
  [['core','version'], 'wpcli_read'],
  [['core','update'], 'wpcli'],
  // `db export` reads the DB but writes a dump — every user hash and every
  // option row — into the SSH login directory, which is the web root on many
  // hosts. It is a write. See the comment above WPCLI_READ_COMMANDS.
  [['db','export'], 'wpcli'],
  [['db','import','f.sql'], 'wpcli'],
  [['search-replace','a','b'], 'wpcli'],
  [['post','create'], 'wpcli'],
  [['post','update','1'], 'wpcli'],
  [['post','delete','1'], 'wpcli'],
  [['user','list'], 'wpcli_read'],
  [['option','get','siteurl'], 'wpcli_read'],
  [['site','health'], 'wpcli_read'],
];

describe('surface equivalence', () => {
  it('no CLI command is blocked by the unified policy', () => {
    const blocked = CLI_COMMANDS.filter((c) => checkCommand(c, REMOTE_POLICY) !== null);
    expect(blocked).toEqual([]);
  });

  it('the arbitrary-code commands are blocked for every surface', () => {
    for (const c of [['eval','x'], ['eval-file','f'], ['shell'], ['db','query','x'], ['db','cli']]) {
      expect(checkCommand(c, REMOTE_POLICY)).not.toBeNull();
    }
  });

  it.each(COMMAND_CLASSIFICATIONS)('classifies %j as %s', (cmd, expectedOp) => {
    expect(classifyWpCliOp(cmd)).toBe(expectedOp);
  });

  it('refuses db export on production, and would leave the dump in the web root if it did not', () => {
    // Pinned separately from the property below so the intent survives even if
    // the classification table is edited: `wp db export` with no path writes
    // <dbname>-<date>.sql into the SSH login directory.
    const settings = { remoteOperationPermissions: DEFAULT_OPERATION_PERMISSIONS };
    expect(classifyWpCliOp(['db', 'export'])).toBe('wpcli');
    expect(isOperationAllowed('wpcli', 'production', settings, 'ssh:box')).toBe(false);
  });

  it('refuses every write on production and permits every read', () => {
    const settings = { remoteOperationPermissions: DEFAULT_OPERATION_PERMISSIONS };
    for (const cmd of CLI_COMMANDS) {
      const op = classifyWpCliOp(cmd);
      const allowed = isOperationAllowed(op, 'production', settings, 'wpe:x');
      expect(allowed).toBe(op === 'wpcli_read');
    }
  });

  it('permits reads and writes on staging', () => {
    const settings = { remoteOperationPermissions: DEFAULT_OPERATION_PERMISSIONS };
    for (const cmd of CLI_COMMANDS) {
      expect(isOperationAllowed(classifyWpCliOp(cmd), 'staging', settings, 'wpe:x')).toBe(true);
    }
  });
});
