// tests/unit/agents/security-sentinel/specialists.test.js
'use strict';

const enumerator   = require('../../../../agents/security-sentinel/specialists/enumerator');
const integrity    = require('../../../../agents/security-sentinel/specialists/integrity');
const pattern      = require('../../../../agents/security-sentinel/specialists/pattern');
const database     = require('../../../../agents/security-sentinel/specialists/database');
const behavioral   = require('../../../../agents/security-sentinel/specialists/behavioral');
const synthesizer  = require('../../../../agents/security-sentinel/specialists/synthesizer');

describe('Sentinel specialist modules', () => {
  const specialists = [enumerator, integrity, pattern, database, behavioral, synthesizer];
  specialists.forEach((mod, i) => {
    it(`specialist ${i + 1}: exports schema and buildPrompt`, () => {
      expect(typeof mod.schema).toBe('object');
      expect(typeof mod.schema.type).toBe('string');
      expect(Array.isArray(mod.schema.required)).toBe(true);
      expect(mod.schema.required.length).toBeGreaterThan(0);
      expect(typeof mod.buildPrompt).toBe('function');
    });
  });

  it('enumerator.buildPrompt includes installName', () => {
    const prompt = enumerator.buildPrompt({ installName: 'testsite', pluginDirectoriesRaw: '', unexpectedFilesRaw: '', htaccessPathsRaw: '', nonStandardTablesRaw: '', autoloadedOptionsRaw: '' });
    expect(prompt).toContain('testsite');
  });

  it('pattern schema requires temporalCluster field', () => {
    expect(pattern.schema.required).toContain('temporalCluster');
    expect(pattern.schema.properties.temporalCluster.properties.detected.type).toBe('boolean');
  });

  it('synthesizer schema requires blindSpots and entryPoint', () => {
    expect(synthesizer.schema.required).toContain('blindSpots');
    expect(synthesizer.schema.required).toContain('entryPoint');
    expect(synthesizer.schema.required).toContain('temporalNarrative');
  });

  it('collectSpecialistData returns all required keys', async () => {
    const agent = require('../../../../agents/security-sentinel/agent');
    const mockTools = {
      invoke: jest.fn().mockResolvedValue('[]'),
    };
    // stub fetch for behavioral
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ status: 200, headers: new Map(), text: async () => '' });
    const data = await agent._test.collectSpecialistData('test-sandbox', 'https://test.wpengine.com', mockTools);
    global.fetch = origFetch;
    expect(data).toHaveProperty('pluginDirectoriesRaw');
    expect(data).toHaveProperty('patternScanOutput');
    expect(data).toHaveProperty('postsContent');
    expect(data).toHaveProperty('standardResponse');
    // Verify behavioral fallback shapes are always present
    expect(data.standardResponse).toHaveProperty('status');
    expect(data.standardResponse).toHaveProperty('headers');
    expect(data.standardResponse).toHaveProperty('bodyPreview');
    expect(data.googlebotResponse).toHaveProperty('status');
    expect(data.googleReferrerResponse).toHaveProperty('status');
  });
});
