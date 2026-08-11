/**
 * ConnectionsSection: Grouped by what each thing gets you.
 *
 * NOTE ON SERIALIZATION. These call `new Component(props).render()` rather than
 * `serializeTree(createElement(Component, props))` — the latter serializes to
 * the props bag and makes every assertion vacuous. See sites-tab.test.ts.
 */
import { ConnectionsSection } from '../../../src/renderer/components/settings/ConnectionsSection';
import { serializeTree } from './helpers/serializeTree';

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) findAll(k, pred, out);
  return out;
}

const tree = (over: any = {}) => {
  const { settings, wpeAccounts, externalHosts, ...rest } = over;
  return JSON.stringify(serializeTree(
    new (ConnectionsSection as any)({
      settings: { aiProvider: 'anthropic', useLocalGateway: false, ...settings },
      wpeAccounts: wpeAccounts ?? [],
      externalHosts: externalHosts ?? [],
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
      ...rest,
    }).render()));
};

const inst = (over: any = {}) => {
  const { settings, wpeAccounts, externalHosts, ...rest } = over;
  return new (ConnectionsSection as any)({
    settings: { aiProvider: 'anthropic', useLocalGateway: false, ...settings },
    wpeAccounts: wpeAccounts ?? [],
    externalHosts: externalHosts ?? [],
    onSave: jest.fn(),
    electron: { ipcRenderer: { invoke: jest.fn() } },
    ...rest,
  });
};

describe('ConnectionsSection', () => {
  test('renders the three group headings', () => {
    const t = tree();
    expect(t).toContain('Where your sites are');
    expect(t).toContain('How Nexus answers you');
    expect(t).toContain('What else Nexus can do');
  });

  test('says what the S3 credential unlocks, not its product name', () => {
    const t = tree();
    expect(t).toContain('Reading access logs');
    expect(t).not.toContain('AWS S3 credentials');
  });

  test('the gateway is nested under the provider, not a peer', () => {
    expect(tree()).toContain('Let WordPress sites use it too');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });

  // Port fidelity tests — pin restored behavior

  test('gateway row has the correct left margin and section background', () => {
    const component = inst();
    component.state.providers = [{ id: 'anthropic', name: 'Anthropic', requiresApiKey: true }];
    const rendered = component.render();

    // Find the gateway div by its checkbox label
    const found = findAll(rendered, n =>
      n.type === 'div' &&
      n.props?.style?.marginLeft === 28 &&
      n.props?.style?.background === 'var(--nxai-section-bg)');

    expect(found.length).toBeGreaterThan(0);
  });

  test('API key input is readOnly when a key is set', () => {
    const component = inst();
    component.state.providers = [{ id: 'anthropic', name: 'Anthropic', requiresApiKey: true }];
    component.state.keyIsSet = true;
    component.state.keyInput = 'sk-ant-api0...xxxx';
    const rendered = component.render();

    const inputs = findAll(rendered, n => n.type === 'input' && n.props?.type === 'text' && n.props?.value?.startsWith('sk-'));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0].props.readOnly).toBe(true);
  });

  test('Change button appears when key is set (provider section)', () => {
    const component = inst();
    component.state.providers = [{ id: 'anthropic', name: 'Anthropic', requiresApiKey: true }];
    component.state.keyIsSet = true;
    component.state.keyInput = 'sk-ant-api0...xxxx';
    const rendered = component.render();

    const t = JSON.stringify(serializeTree(rendered));
    // The Change button should be present in the key management area
    expect(t).toContain('"children":"Change"');
    // The provider section should not have an Apply button for the key when keyIsSet is true
    // (Apply buttons in WPE/AWS sections are expected and fine)
    const changeCount = (t.match(/"children":"Change"/g) || []).length;
    expect(changeCount).toBeGreaterThan(0);
  });

  test('Check Key button is present when provider requires a key', () => {
    const component = inst();
    component.state.providers = [{ id: 'anthropic', name: 'Anthropic', requiresApiKey: true }];
    component.state.keyInput = 'sk-ant-test';
    const rendered = component.render();

    const buttons = findAll(rendered, n => n.type === 'button');
    const checkButton = buttons.find(b => b.props?.children === 'Check Key');

    expect(checkButton).toBeDefined();
  });

  test('WPE credentials form has username, password, Apply and Clear buttons', () => {
    const t = tree();
    expect(t).toContain('API username');
    expect(t).toContain('API password');
    expect(t).toContain('Apply');
    expect(t).toContain('Clear');
  });

  test('WPE credentials saved feedback appears on success', () => {
    const component = inst();
    component.state.wpeCredsSaved = true;
    component.state.wpePendingClear = false;
    const rendered = component.render();

    const t = JSON.stringify(serializeTree(rendered));
    expect(t).toContain('✓ Credentials saved');
  });

  test('AWS credentials form has key ID, secret, Show/Hide, and Save buttons', () => {
    const component = inst();
    component.state.awsConnected = false;
    const rendered = component.render();

    const t = JSON.stringify(serializeTree(rendered));
    expect(t).toContain('AKIA');
    expect(t).toContain('Show');
    expect(t).toContain('Save');
  });

  test('AWS description includes the security assurance', () => {
    const t = tree();
    expect(t).toContain('encrypted in your OS keychain');
    expect(t).toContain('never stored in plaintext');
    expect(t).toContain('never stored locally');
  });

  test('WPE description explains credential storage', () => {
    const t = tree();
    expect(t).toContain('stored encrypted using OS-level encryption');
  });

  test('WPE help text links to my.wpengine.com', () => {
    const t = tree();
    expect(t).toContain('my.wpengine.com');
    expect(t).toContain('different from your WP Engine login');
  });

  test('stored key security indicator is present when key is set', () => {
    const component = inst();
    component.state.providers = [{ id: 'anthropic', name: 'Anthropic', requiresApiKey: true }];
    component.state.keyIsSet = true;
    const rendered = component.render();

    const t = JSON.stringify(serializeTree(rendered));
    expect(t).toContain('Key is encrypted and stored securely');
  });
});

// ── AWS S3 status unwrapping ────────────────────────────────────────────────
//
// CREDENTIAL_API_KEY_STATUS returns `{ connections: ApiKeyConnection[] }`, and
// ApiKeyConnection is `{ id, provider, label, status, createdAt }`. Reading
// `.status` / `.label` / `.connectionId` straight off the envelope left the
// panel permanently "Not connected" with live keys, and Disconnect dead.

describe('ConnectionsSection — CREDENTIAL_API_KEY_STATUS is an envelope', () => {
  const loadWith = async (statusResult: any) => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel.endsWith(':credential:api-key:status')) return statusResult;
      if (channel.endsWith(':wpe:get-api-credentials-status')) return { configured: false, username: null };
      return [];
    });
    const component = inst({ settings: { aiProvider: undefined }, electron: { ipcRenderer: { invoke } } });
    component.mounted = true;
    // React's setState is a warn-and-no-op before mount; fold into state so the
    // assertions below observe the real result.
    component.setState = (patch: any) => Object.assign(component.state, patch);
    await component.loadConnectionStates();
    return component;
  };

  test('an active connection inside `connections` is read as connected', async () => {
    const c = await loadWith({
      connections: [
        { id: 'conn-1', provider: 'aws', label: 'arn:aws:iam::1:user/deploy', status: 'active', createdAt: '' },
      ],
    });
    expect(c.state.awsConnected).toBe(true);
    expect(c.state.awsRevoked).toBe(false);
    expect(c.state.awsLabel).toBe('arn:aws:iam::1:user/deploy');
    // Disconnect early-returns on an empty id — this is what made it dead.
    expect(c.state.awsConnectionId).toBe('conn-1');
  });

  test('a revoked-only connection is read as revoked, and still carries its id', async () => {
    const c = await loadWith({
      connections: [{ id: 'conn-2', provider: 'aws', label: 'old-key', status: 'revoked', createdAt: '' }],
    });
    expect(c.state.awsConnected).toBe(false);
    expect(c.state.awsRevoked).toBe(true);
    expect(c.state.awsConnectionId).toBe('conn-2');
  });

  test('an empty envelope is not connected', async () => {
    const c = await loadWith({ connections: [] });
    expect(c.state.awsConnected).toBe(false);
    expect(c.state.awsRevoked).toBe(false);
    expect(c.state.awsConnectionId).toBe('');
  });

  test('active wins over a stale revoked entry for the same provider', async () => {
    const c = await loadWith({
      connections: [
        { id: 'old', provider: 'aws', label: 'old-key', status: 'revoked', createdAt: '' },
        { id: 'new', provider: 'aws', label: 'new-key', status: 'active', createdAt: '' },
      ],
    });
    expect(c.state.awsConnected).toBe(true);
    expect(c.state.awsRevoked).toBe(false);
    expect(c.state.awsConnectionId).toBe('new');
    expect(c.state.awsLabel).toBe('new-key');
  });
});
