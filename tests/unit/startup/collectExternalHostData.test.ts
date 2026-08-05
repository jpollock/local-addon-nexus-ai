// tests/unit/startup/collectExternalHostData.test.ts
import { collectExternalHostData } from '../../../src/main/startup/collectExternalHostData';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/** Answers each batch in order with the supplied section arrays. */
function runner(...batches: (string | null)[][]) {
  const queue = [...batches];
  return {
    runWpCliBatch: jest.fn(async (cmds: string[][]) => {
      const next = queue.shift();
      return next ?? new Array(cmds.length).fill(null);
    }),
  };
}

describe('collectExternalHostData', () => {
  it('parses PHP version from wp --info JSON', async () => {
    const scalars = new Array(18).fill(null);
    scalars[0] = '6.8.0';
    scalars[1] = JSON.stringify({ php_version: '8.2.10', wp_cli_version: '2.9.0' });
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.wpVersion).toBe('6.8.0');
    expect(data.phpVersion).toBe('8.2.10');
  });

  it('falls back to the plain-text "PHP version:" line on older WP-CLI', async () => {
    const scalars = new Array(18).fill(null);
    scalars[1] = 'OS:\tLinux\nPHP binary:\t/usr/bin/php8.1\nPHP version:\t8.1.27\nWP-CLI version:\t2.7.1';
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.phpVersion).toBe('8.1.27');
  });

  it('leaves phpVersion undefined when neither form parses — never a default', async () => {
    const scalars = new Array(18).fill(null);
    scalars[1] = 'total gibberish';
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.phpVersion).toBeUndefined();
    expect(data).not.toHaveProperty('phpVersion', '8.0');
  });

  it('never mistakes the WP-CLI version for the PHP version', async () => {
    const scalars = new Array(18).fill(null);
    scalars[1] = 'WP-CLI version:\t2.9.0';
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.phpVersion).toBeUndefined();
  });

  it('parses plugins and themes as JSON with active status', async () => {
    const plugins = [JSON.stringify([
      { name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' },
      { name: 'hello', title: 'Hello Dolly', version: '1.7', status: 'inactive' },
    ])];
    const themes = [JSON.stringify([{ name: 'twentytwentyfour', title: 'TT4', version: '1.0', status: 'active' }])];
    const data = await collectExternalHostData(
      runner(new Array(18).fill(null), plugins, themes), logger);
    expect(data.plugins).toEqual([
      { slug: 'akismet', name: 'Akismet', version: '5.3', isActive: true },
      { slug: 'hello', name: 'Hello Dolly', version: '1.7', isActive: false },
    ]);
    expect(data.themes).toEqual([
      { slug: 'twentytwentyfour', name: 'TT4', version: '1.0', isActive: true },
    ]);
  });

  it('leaves plugins undefined — NOT an empty array — when the batch returned nothing', async () => {
    const data = await collectExternalHostData(runner(new Array(18).fill(null), [null], [null]), logger);
    expect(data.plugins).toBeUndefined();
    expect(data.themes).toBeUndefined();
  });

  it('distinguishes a genuinely empty plugin list from a failed one', async () => {
    const data = await collectExternalHostData(
      runner(new Array(18).fill(null), ['[]'], [null]), logger);
    expect(data.plugins).toEqual([]);
    expect(data.themes).toBeUndefined();
  });

  it('parses counts as numbers and leaves unparseable ones undefined, never 0', async () => {
    const counts = ['42', '17', JSON.stringify([{ post_modified: '2026-01-15 10:30:00' }]), '5', '2', 'not-a-number'];
    const data = await collectExternalHostData(
      runner(new Array(18).fill(null), [null], [null], counts), logger);
    expect(data.postCount).toBe(42);
    expect(data.userCount).toBe(5);
    expect(data.editorCount).toBeUndefined();
  });

  it('collects the 11 settings options into settingsJson, omitting ones that did not answer', async () => {
    const scalars = new Array(18).fill(null);
    scalars[5] = 'My Blog';        // blogname
    scalars[6] = 'Just another';   // blogdescription
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(JSON.parse(data.settingsJson!)).toEqual({ blogname: 'My Blog', blogdescription: 'Just another' });
  });

  it('omits settingsJson entirely when no option answered', async () => {
    const data = await collectExternalHostData(runner(new Array(18).fill(null)), logger);
    expect(data.settingsJson).toBeUndefined();
  });

  it('makes exactly four SSH round trips', async () => {
    const r = runner();
    await collectExternalHostData(r, logger);
    expect(r.runWpCliBatch).toHaveBeenCalledTimes(4);
  });
});
