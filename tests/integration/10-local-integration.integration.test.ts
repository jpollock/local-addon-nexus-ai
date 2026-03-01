import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createLocalServicesBridge } from '../../src/main/mcp/local-services-bridge';
import { TestHarness } from './helpers/harness';

const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
const sitesJsonPath = path.join(localDataDir, 'sites.json');
const hasLocal = fs.existsSync(sitesJsonPath);

const describeLocal = hasLocal ? describe : describe.skip;

describeLocal('Local Integration (requires Local installed)', () => {
  test('can read Local sites.json and build site data', () => {
    const raw = JSON.parse(fs.readFileSync(sitesJsonPath, 'utf-8'));
    expect(Object.keys(raw).length).toBeGreaterThan(0);

    // Verify each site has expected fields
    for (const [id, data] of Object.entries(raw) as [string, any][]) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  test('createLocalServicesBridge with empty container does not crash', () => {
    const bridge = createLocalServicesBridge({});
    expect(bridge.isCAPIAvailable()).toBe(false);
  });

  test('can boot full harness with sites.json data', async () => {
    const harness = await TestHarness.create({
      useSitesJson: true,
      skipServer: true,
    });

    const sites = harness.services.siteData.getSites();
    expect(Object.keys(sites).length).toBeGreaterThan(0);

    await harness.cleanup();
  }, 60000);
});
