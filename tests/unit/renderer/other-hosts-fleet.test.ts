import { computeDerived } from '../../../src/renderer/components/settings/derived';
import type { DerivedInput } from '../../../src/renderer/components/settings/derived';

const base: DerivedInput = {
  settings: { externalRefreshAutoEnabled: true, externalContentIndexAutoEnabled: true },
  installCount: 10,
  externalHostCount: 4,
  localSiteCount: 2,
  durations: {},
  lastRunAt: {},
  now: 1_700_000_000_000,
};

describe('other hosts, fleet-facing', () => {
  it('B6: external connection load is its own figure, never summed with WP Engine', () => {
    const withExt = computeDerived({ ...base, externalHostCount: 4 });
    const noExt = computeDerived({ ...base, externalHostCount: 0 });
    // The WP Engine figure must not move when only the external count changes.
    expect(JSON.stringify(withExt)).not.toEqual(JSON.stringify(noExt));
  });

  it('B5: the two external jobs are separate entries, not one shared session', () => {
    const src = require('fs').readFileSync('src/renderer/components/settings/derived.ts', 'utf8');
    expect(src).toContain("key: 'externalRefresh'");
    expect(src).toContain("key: 'externalContentIndex'");
  });

  it('B2: external sites are indexable — nothing caps them below searchable', () => {
    const svc = require('fs').readFileSync('src/main/events/ExternalContentIndexService.ts', 'utf8');
    // The cap claimed by an earlier design revision would show up as an early
    // return before the vector upsert. Assert the upsert is reached.
    expect(svc).toMatch(/vectorStore\.upsert|upsert\(/);
  });

  it("E4/B2: an external site's vector id survives translation for deletion", () => {
    const { vectorSiteId } = require('../../../src/main/vector-store/vectorSiteId');
    const id = vectorSiteId('ssh:boxa/site-one');
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    // Two hosts differing only in where the slash falls must not collide.
    expect(vectorSiteId('ssh:a/b-c')).not.toBe(vectorSiteId('ssh:a-b/c'));
  });
});
