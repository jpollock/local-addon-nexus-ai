import { createTestRegistry } from './helpers/registry-harness';

describe('Instructions Quality', () => {
  const registry = createTestRegistry();
  const instructions = registry.getInstructions();

  // -------------------------------------------------------------------------
  // Discovery First
  // -------------------------------------------------------------------------

  it('mentions local_list_sites as a discovery tool', () => {
    expect(instructions).toContain('local_list_sites');
  });

  it('mentions nexus_list_sites as a discovery tool', () => {
    expect(instructions).toContain('nexus_list_sites');
  });

  it('emphasizes discovery-first principle', () => {
    expect(instructions).toMatch(/always.*call.*list_sites/i);
  });

  it('tells agents not to ask for site IDs', () => {
    expect(instructions).toMatch(/never.*ask.*(?:user|site\s*id|name)/i);
  });

  // -------------------------------------------------------------------------
  // Tool Namespace Coverage
  // -------------------------------------------------------------------------

  it('mentions wp_ tool namespace', () => {
    expect(instructions).toContain('wp_');
  });

  it('mentions wpe_ tool namespace', () => {
    expect(instructions).toContain('wpe_');
  });

  it('mentions local_ tool namespace', () => {
    expect(instructions).toContain('local_');
  });

  it('mentions fleet_ tool namespace', () => {
    expect(instructions).toContain('fleet_');
  });

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  it('contains a routing table or tool mapping', () => {
    expect(instructions).toMatch(/routing|tool.*namespace|user.*intent/i);
  });

  it('mentions key tools in routing', () => {
    expect(instructions).toContain('wp_plugin_list');
    expect(instructions).toContain('wp_core_version');
    expect(instructions).toContain('local_start_site');
  });

  it('mentions composite tools in routing', () => {
    expect(instructions).toContain('nexus_site_audit');
    expect(instructions).toContain('nexus_plugin_audit');
  });

  // -------------------------------------------------------------------------
  // Ollama
  // -------------------------------------------------------------------------

  it('mentions ask_ollama site context injection', () => {
    expect(instructions).toMatch(/ask_ollama.*site/is);
  });

  it('mentions hardware-aware model recommendations', () => {
    expect(instructions).toMatch(/hardware|RAM/i);
  });

  // -------------------------------------------------------------------------
  // Local vs Remote
  // -------------------------------------------------------------------------

  it('explains the site parameter for local execution', () => {
    expect(instructions).toMatch(/\bsite\b.*param/i);
  });

  it('explains the install_name parameter for remote execution', () => {
    expect(instructions).toContain('install_name');
  });

  it('warns not to use both site and install_name', () => {
    expect(instructions).toMatch(/never.*pass.*both/i);
  });

  // -------------------------------------------------------------------------
  // Safety
  // -------------------------------------------------------------------------

  it('mentions the safety tier system', () => {
    expect(instructions).toMatch(/tier\s*1/i);
    expect(instructions).toMatch(/tier\s*2/i);
    expect(instructions).toMatch(/tier\s*3/i);
  });

  it('mentions confirmation tokens', () => {
    expect(instructions).toMatch(/confirm.*token/i);
  });

  it('mentions dry-run', () => {
    expect(instructions).toMatch(/dry.?run/i);
  });

  // -------------------------------------------------------------------------
  // Presentation
  // -------------------------------------------------------------------------

  it('includes presentation guidance', () => {
    expect(instructions).toMatch(/format|presentation|table|list/i);
  });

  // -------------------------------------------------------------------------
  // Structural Quality
  // -------------------------------------------------------------------------

  it('has reasonable length (>500 chars, <15000 chars)', () => {
    expect(instructions.length).toBeGreaterThan(500);
    expect(instructions.length).toBeLessThan(15000);
  });

  it('is non-empty', () => {
    expect(instructions.trim().length).toBeGreaterThan(0);
  });

  it('uses markdown formatting', () => {
    expect(instructions).toMatch(/^#/m); // Has headings
    expect(instructions).toContain('|'); // Has tables
  });
});
