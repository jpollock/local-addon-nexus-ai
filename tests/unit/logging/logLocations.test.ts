/**
 * fixes-082526 · issue 4 — the log surface has to describe itself.
 */
import { LOG_LOCATIONS, resolveLogLocations } from '../../../src/common/logLocations';

describe('log locations', () => {
  it('names all four durable families, not just the folder', () => {
    expect(LOG_LOCATIONS).toHaveLength(4);
    const rels = LOG_LOCATIONS.map((l) => l.relPath);
    expect(rels).toContain('operation-audit.log');   // the compliance record
    expect(rels).toContain('audit.log');
    expect(rels.some((r) => r.startsWith('logs/agents/'))).toBe(true);
    expect(rels.some((r) => /logs\/nexus-/.test(r))).toBe(true);
  });

  it('every entry says what question it answers — a path alone is not an answer', () => {
    for (const l of LOG_LOCATIONS) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.answers.length).toBeGreaterThan(20);
    }
  });

  it('resolves against a data dir, with or without a trailing slash', () => {
    expect(resolveLogLocations('/tmp/nexus-ai')[2].path).toBe('/tmp/nexus-ai/operation-audit.log');
    expect(resolveLogLocations('/tmp/nexus-ai/')[2].path).toBe('/tmp/nexus-ai/operation-audit.log');
  });
});
