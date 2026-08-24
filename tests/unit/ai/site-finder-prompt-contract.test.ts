/**
 * Sheet 19's machinery pins on the parse prompt itself — the behavioral
 * rules live in prompt text, so the text is what a test can hold.
 */
import { buildSiteFinderSystemPrompt } from '../../../src/main/ai/site-finder-prompt';

describe('the site-finder prompt contract', () => {
  const prompt = buildSiteFinderSystemPrompt();

  test('no partial interpretation: the whole query resolves or none of it does', () => {
    expect(prompt).toContain('NO PARTIAL INTERPRETATION');
    expect(prompt).toContain('If ANY part of the query cannot be mapped');
    expect(prompt).toContain('"ACF sites with lots of traffic"');    // the mixed-clause example
  });

  test('clarifications carry the facet they name, per Board F', () => {
    expect(prompt).toContain('CLARIFICATION CONTRACT');
    expect(prompt).toContain('"facet"');
    expect(prompt).toContain('"facet": "phpVersions"');
  });

  test('no routing advice reaches user copy — the surface renders its own door', () => {
    expect(prompt).not.toContain('Ask/Tell tab');
    expect(prompt).toContain('NEVER gives routing');
  });

  test('there is exactly one prompt — the legacy inline copy is gone', () => {
    const fs = require('fs');
    const handlers = fs.readFileSync('src/main/ipc-handlers.ts', 'utf8');
    expect(handlers).not.toContain('__legacyPromptStart');
    expect(handlers.split('You are a site finder query parser').length - 1).toBe(0);
  });
});
