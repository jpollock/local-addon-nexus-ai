/**
 * WP-18 · Unit pins for locating the live ledger.
 *
 * The replay's hard constraint is that it never opens the developer's real
 * ledger for writing. That starts with knowing exactly which file it is, on
 * each platform, so the copy step cannot silently land on the wrong path and
 * then "find" an empty ledger — which would replay nothing and pass.
 */
import { liveLedgerPath, localDataDir } from './paths';

const HOME = '/Users/someone';

describe('localDataDir', () => {
  it('is Local\'s own userData directory on darwin', () => {
    expect(localDataDir('darwin', HOME)).toBe(`${HOME}/Library/Application Support/Local`);
  });

  it('differs per platform', () => {
    expect(localDataDir('linux', HOME)).toBe(`${HOME}/.config/Local`);
    expect(localDataDir('darwin', HOME)).not.toBe(localDataDir('linux', HOME));
  });
});

describe('liveLedgerPath', () => {
  it('is nexus-ai/ledger.db under the data dir — the path bootstrap.ts builds', () => {
    expect(liveLedgerPath('darwin', HOME)).toBe(
      `${HOME}/Library/Application Support/Local/nexus-ai/ledger.db`
    );
  });
});
