/**
 * fixes-082526 · item 7 — environment-filter.ts is retired, per CLAUDE.md's
 * own instruction.
 *
 * The entry read: "wpeAllowedEnvironments is dead code — it blocks nothing
 * ... all four exported functions have zero callers outside their own test
 * file ... Delete environment-filter.ts or wire it up; do not cite it as a
 * live protection." Its test suites made the situation worse than dead code:
 * wpe-sync-environment-filter.test.ts claimed to verify "the environment
 * filter logic that WPESyncService applies" — a green suite for a protection
 * that did not run, which is precisely how the false "blocks SSH/WP-CLI on
 * excluded environments" claim survived.
 *
 * What stays, deliberately: the legacy `wpeAllowedEnvironments` SETTING and
 * `migrateFromLegacyEnvFilter` (operation-permissions.ts), the one-way
 * converter into the gate that actually runs (`isOperationAllowed` against
 * `remoteOperationPermissions`).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../../');

describe('the dead filter stays deleted', () => {
  it('the module is gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/main/mcp/utils/environment-filter.ts'))).toBe(false);
  });

  it('nothing under src imports it', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && fs.readFileSync(p, 'utf8').includes('environment-filter')) {
          hits.push(p);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });

  it('the live path survives: the legacy setting still migrates into the real gate', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/mcp/utils/operation-permissions.ts'), 'utf8');
    expect(src).toContain('migrateFromLegacyEnvFilter');
    expect(src).toContain('wpeAllowedEnvironments');
  });
});
