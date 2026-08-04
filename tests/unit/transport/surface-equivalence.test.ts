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

  it.each(CLI_COMMANDS)('classifies %j identically regardless of caller', (...c) => {
    const cmd = c as string[];
    expect(classifyWpCliOp(cmd)).toBe(classifyWpCliOp([...cmd]));
    expect(['wpcli', 'wpcli_read']).toContain(classifyWpCliOp(cmd));
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
