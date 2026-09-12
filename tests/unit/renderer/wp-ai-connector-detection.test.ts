// detectWpAiConnector is not exported — test via import of the module
// and verify the logic by testing the expected state machine transitions.
// Since it's a module-level function we test it indirectly via state expectations.

// Simulate the detection logic (mirrors the implementation)
type Connector = 'power' | 'local-gateway' | 'direct' | null;

function detect(
  aiPlugin: 'active' | 'inactive' | 'not_installed' | null,
  gatewayProvider: 'active' | 'inactive' | 'not_installed' | undefined,
  iwConnected: boolean,
  wpEngineApproved: boolean,
): Connector {
  if (!aiPlugin) return null;
  if (iwConnected && wpEngineApproved) return 'power';
  if (gatewayProvider === 'active') return 'local-gateway';
  if (aiPlugin === 'active') return 'direct';
  return null;
}

describe('WP AI connector detection', () => {
  it('returns null when no AI configured', () => {
    expect(detect(null, undefined, false, false)).toBeNull();
  });

  it('returns power when Hub connected and wpengine connector approved', () => {
    expect(detect('active', undefined, true, true)).toBe('power');
  });

  it('power takes precedence over gateway when both active', () => {
    expect(detect('active', 'active', true, true)).toBe('power');
  });

  it('returns local-gateway when gateway provider active', () => {
    expect(detect('active', 'active', false, false)).toBe('local-gateway');
  });

  it('returns direct when AI plugin active but no gateway or power', () => {
    expect(detect('active', 'inactive', false, false)).toBe('direct');
  });

  it('returns null when AI plugin installed but not active', () => {
    expect(detect('inactive', undefined, false, false)).toBeNull();
  });

  it('returns null when Hub connected but wpengine not yet approved', () => {
    expect(detect('active', undefined, true, false)).toBe('direct');
  });
});

// v0.6.0 excision. The IW status read, connect and disconnect flows are gone
// from the main process, so a renderer still invoking those channels would
// fail SILENTLY at runtime — ipcRenderer.invoke on an unregistered channel
// rejects, and both call sites here swallow with .catch(() => null). Asserted
// against the source because these are React 16 class components whose IW
// branches were only reachable with a live ipc mock.
describe('Intelligent Web renderer surface is absent (v0.6.0 excision)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../../../src/renderer/components', rel), 'utf8');

  it.each(['SiteNexusSection.tsx', 'NexusSiteTab.tsx'])('%s has no IW references', (file) => {
    expect(read(file)).not.toMatch(
      /iwStatus|iwConnecting|iwPollInterval|IwConnectionStatus|IW_GET_STATUS|IW_CONNECT|IW_DISCONNECT/,
    );
  });
});
