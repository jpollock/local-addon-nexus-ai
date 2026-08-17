/**
 * @jest-environment jsdom
 */
/**
 * WP-22 · the container's selection logic, and the id that rides on CHAT_SEND.
 *
 * The defect this packet closes was invisible to every test that existed: the panel
 * sent `selectedSiteIds[0]` from a state field nothing populated, so every turn reached
 * the chat with `siteId: undefined` while the user stood on a site page. Nothing failed
 * — the id was simply absent. So the pins here are about PRESENCE: the id is read from
 * Local's route, it changes when the user navigates, an explicit pin outlives
 * navigation, and it reaches the invoke call.
 *
 * Class-instance style, matching this repo's renderer tests (SitePicker.test.tsx,
 * docked-panel-container.test.ts): Local runs React 16 and there is no mounting harness
 * in this suite. `render()` is called directly and its element tree read — enough to pin
 * what the container hands down without fighting Electron for a DOM.
 */
import { IPC_CHANNELS } from '../../../src/common/constants';

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any, cb?: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
    if (typeof cb === 'function') cb();
  });
}

/** Local's shell, as `MainPage.tsx` renders it. */
function setLocalRoute(path: string): void {
  let shell = document.querySelector('.Window');
  if (!shell) {
    shell = document.createElement('div');
    shell.className = 'Window';
    document.body.appendChild(shell);
  }
  shell.setAttribute('data-location', path);
}

/** WP-22b: what the content-age read answers, per site id. */
const CONTENT: Record<string, unknown> = {
  'site-cedar': { state: 'pulled', sourceName: 'the live site', behindSeconds: 11 * 86_400 },
  'site-alpine': { state: 'unlinked' },
};

function makeElectron() {
  const invoke = jest.fn(async (channel: string, arg?: unknown) => {
    if (channel === IPC_CHANNELS.GET_SITES) {
      return [
        { id: 'site-cedar', name: 'cedarvale' },
        { id: 'site-alpine', name: 'alpine-outfitters' },
      ];
    }
    if (channel === IPC_CHANNELS.GET_SITE_CONTENT_STATUS) {
      return CONTENT[String(arg)] ?? null;
    }
    return null;
  });
  return {
    ipcRenderer: {
      invoke,
      on: jest.fn(),
      send: jest.fn(),
      removeListener: jest.fn(),
    },
  };
}

function makeContainer() {
  const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
  const electron = makeElectron();
  const inst: any = new DockedPanelContainer({ electron });
  spySetState(inst);
  return { inst, electron };
}

/** What the container hands the chat, read straight off the rendered element tree. */
function chatProps(inst: any): any {
  return inst.render().props.children.props;
}

describe('DockedPanelContainer — the site on screen becomes the chat\'s site', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
  });

  it('starts with no site — never a guess', () => {
    const { inst } = makeContainer();
    expect(inst.state.viewedSiteId).toBeNull();
    expect(inst.state.siteOverride).toBeNull();
    expect(inst.state.siteChoices).toEqual([]);
  });

  it('reads the viewed site from Local\'s shell', () => {
    setLocalRoute('/main/site-info/site-cedar/nexus');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    expect(inst.state.viewedSiteId).toBe('site-cedar');
  });

  it('sends that site id on CHAT_SEND', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    expect(chatProps(inst).selectedSiteIds).toEqual(['site-cedar']);
  });

  it('sends NOTHING when no site page is open', () => {
    setLocalRoute('/main/nexus');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    expect(inst.state.viewedSiteId).toBeNull();
    expect(chatProps(inst).selectedSiteIds).toEqual([]);
    expect(chatProps(inst).siteContext.mode).toBe('none');
  });

  it('follows the user to another site mid-session', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    expect(chatProps(inst).selectedSiteIds).toEqual(['site-cedar']);

    setLocalRoute('/main/site-info/site-alpine');
    inst.refreshViewedSite();
    expect(chatProps(inst).selectedSiteIds).toEqual(['site-alpine']);
  });

  it('falls back to the hash when the shell has not rendered', () => {
    window.location.hash = '#/main/site-info/site-alpine';
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    expect(inst.state.viewedSiteId).toBe('site-alpine');
    window.location.hash = '';
  });
});

describe('DockedPanelContainer — an explicit pin beats navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
  });

  it('a pinned site wins over the site on screen', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    inst.pickSite('site-alpine');

    expect(chatProps(inst).selectedSiteIds).toEqual(['site-alpine']);
    expect(chatProps(inst).siteContext.mode).toBe('override');
  });

  it('the pin SURVIVES navigating to a different site', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    inst.pickSite('site-alpine');

    setLocalRoute('/main/site-info/site-cedar-two');
    inst.refreshViewedSite();

    expect(inst.state.viewedSiteId).toBe('site-cedar-two');
    expect(chatProps(inst).selectedSiteIds).toEqual(['site-alpine']);
  });

  it('the pin survives navigating away from every site page', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    inst.pickSite('site-alpine');

    setLocalRoute('/main/nexus');
    inst.refreshViewedSite();

    expect(chatProps(inst).selectedSiteIds).toEqual(['site-alpine']);
    expect(chatProps(inst).siteContext.mode).toBe('override');
  });

  it('clearing hands scope back to the site on screen, not to nothing', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    inst.pickSite('site-alpine');
    inst.clearSiteOverride();

    expect(chatProps(inst).selectedSiteIds).toEqual(['site-cedar']);
    expect(chatProps(inst).siteContext.mode).toBe('viewed');
  });
});

describe('DockedPanelContainer — naming the site for the strip', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
  });

  it('names the site once Local\'s list has loaded', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    inst.loadSiteChoices();
    await Promise.resolve();
    await Promise.resolve();

    expect(chatProps(inst).siteContext.siteName).toBe('cedarvale');
  });

  it('falls back to the id rather than an empty band', () => {
    setLocalRoute('/main/site-info/site-unknown');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    expect(chatProps(inst).siteContext.siteName).toBe('site-unknown');
  });

  it('discloses the site on screen when a pin points somewhere else', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.loadSiteChoices();
    await Promise.resolve();
    await Promise.resolve();
    inst.refreshViewedSite();
    inst.pickSite('site-alpine');

    const ctx = chatProps(inst).siteContext;
    expect(ctx.siteName).toBe('alpine-outfitters');
    expect(ctx.viewedSiteName).toBe('cedarvale');
  });

  it('survives a site list that never arrives', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const electron = { ipcRenderer: { invoke: jest.fn(async () => { throw new Error('nope'); }), on: jest.fn(), send: jest.fn(), removeListener: jest.fn() } };
    const inst: any = new DockedPanelContainer({ electron });
    spySetState(inst);
    inst.refreshViewedSite();
    inst.loadSiteChoices();
    await Promise.resolve();
    await Promise.resolve();

    expect(inst.state.siteChoices).toEqual([]);
    expect(chatProps(inst).selectedSiteIds).toEqual(['site-cedar']);
  });
});

describe('PanelChat — the id reaches the invoke call', () => {
  beforeEach(() => { jest.resetModules(); });

  async function send(selectedSiteIds: string[]) {
    const { PanelChat } = require('../../../src/renderer/components/DockedPanel/PanelChat');
    const invoke = jest.fn(async (..._args: unknown[]) => undefined);
    const inst: any = new PanelChat({
      electron: { ipcRenderer: { invoke, on: jest.fn(), send: jest.fn(), removeListener: jest.fn() } },
      sessionId: 'session-1',
      selectedSiteIds,
      siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
      visible: true,
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
    });
    spySetState(inst);
    inst.state.input = 'where am I?';
    await inst.handleSend();
    return invoke.mock.calls.find((c: any[]) => c[0] === IPC_CHANNELS.CHAT_SEND);
  }

  // invoke(channel, sessionId, message, providerId, model, siteId) — siteId is the
  // last positional, index 5 counting the channel. PanelChat's own comment calls it
  // the fifth CHAT_SEND argument, which it is once the channel is dropped.
  const SITE_ID_ARG = 5;

  it('carries the selected site as CHAT_SEND\'s site argument', async () => {
    const call = await send(['site-cedar']);
    expect(call).toBeDefined();
    expect(call![SITE_ID_ARG]).toBe('site-cedar');
  });

  it('carries undefined when nothing is selected — not an empty string', async () => {
    const call = await send([]);
    expect(call).toBeDefined();
    expect(call![SITE_ID_ARG]).toBeUndefined();
  });
});

/**
 * WP-22b · the one IPC read behind the content-age chip.
 *
 * The pins here are all about what must NOT happen: the read must not block the
 * composer, must not answer for a site the user has left, and must not be able to take
 * the band down when it fails. The chip is detail; the band is the disclosure.
 */
describe('DockedPanelContainer — reading the selected copy\'s content age', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
  });

  const contentCalls = (electron: any) =>
    electron.ipcRenderer.invoke.mock.calls.filter(
      (c: any[]) => c[0] === IPC_CHANNELS.GET_SITE_CONTENT_STATUS,
    );

  it('asks about the site on screen, and hands the answer to the strip', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst, electron } = makeContainer();
    inst.refreshViewedSite();
    await Promise.resolve();
    await Promise.resolve();

    expect(contentCalls(electron).map((c: any[]) => c[1])).toEqual(['site-cedar']);
    expect(chatProps(inst).siteContext.content).toEqual({
      state: 'pulled',
      sourceName: 'the live site',
      behindSeconds: 11 * 86_400,
    });
  });

  it('asks about the PINNED site, not the one on screen', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst, electron } = makeContainer();
    inst.refreshViewedSite();
    inst.pickSite('site-alpine');
    await Promise.resolve();
    await Promise.resolve();

    expect(contentCalls(electron).map((c: any[]) => c[1])).toEqual(['site-cedar', 'site-alpine']);
    // 'unlinked' is a real answer and reaches the strip; the strip is what declines to
    // render it. Flattening it to null here would lose a distinction the read made.
    expect(chatProps(inst).siteContext.content).toEqual({ state: 'unlinked' });
  });

  it('asks nothing when no site is selected', async () => {
    setLocalRoute('/main/nexus');
    const { inst, electron } = makeContainer();
    inst.refreshViewedSite();
    await Promise.resolve();

    expect(contentCalls(electron)).toHaveLength(0);
    expect(chatProps(inst).siteContext.content).toBeNull();
  });

  it('does not re-ask for a site it is already showing', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst, electron } = makeContainer();
    inst.refreshViewedSite();
    await Promise.resolve();
    await Promise.resolve();
    inst.refreshViewedSite();
    inst.refreshContentStatus();

    expect(contentCalls(electron)).toHaveLength(1);
  });

  it('renders the band and the chat BEFORE the read answers', () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();

    // Nothing is awaited: the id the chat sends and the band the user reads are both
    // already correct while the content read is still in flight.
    const props = chatProps(inst);
    expect(props.selectedSiteIds).toEqual(['site-cedar']);
    expect(props.siteContext.siteName).toBe('site-cedar');
    expect(props.siteContext.content).toBeNull();
  });

  it('drops an answer that arrives for a site the user has left', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');

    const pending: Array<{ siteId: string; resolve: (v: unknown) => void }> = [];
    const electron = {
      ipcRenderer: {
        invoke: jest.fn((channel: string, arg?: unknown) => {
          if (channel === IPC_CHANNELS.GET_SITE_CONTENT_STATUS) {
            return new Promise((resolve) => pending.push({ siteId: String(arg), resolve }));
          }
          return Promise.resolve(null);
        }),
        on: jest.fn(),
        send: jest.fn(),
        removeListener: jest.fn(),
      },
    };
    const inst: any = new DockedPanelContainer({ electron });
    spySetState(inst);

    inst.refreshViewedSite();                       // asks about cedar
    setLocalRoute('/main/site-info/site-alpine');
    inst.refreshViewedSite();                       // and now about alpine

    // Cedar's answer lands late. It is one site's content age and the band now names
    // another — the worst possible pairing, and the reason the request is keyed.
    pending.find((p) => p.siteId === 'site-cedar')!.resolve({
      state: 'pulled', sourceName: 'the live site', behindSeconds: 99 * 86_400,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chatProps(inst).siteContext.content).toBeNull();
  });

  it('survives a channel that is not there at all', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const electron = {
      ipcRenderer: {
        invoke: jest.fn(async () => { throw new Error('no handler registered'); }),
        on: jest.fn(), send: jest.fn(), removeListener: jest.fn(),
      },
    };
    const inst: any = new DockedPanelContainer({ electron });
    spySetState(inst);
    inst.refreshViewedSite();
    await Promise.resolve();
    await Promise.resolve();

    // The band is exactly what WP-22 shipped, and the chat still carries its site.
    expect(chatProps(inst).siteContext.content).toBeNull();
    expect(chatProps(inst).selectedSiteIds).toEqual(['site-cedar']);
    expect(chatProps(inst).siteContext.mode).toBe('viewed');
  });

  it('refuses a payload it was not designed for', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const electron = {
      ipcRenderer: {
        invoke: jest.fn(async (channel: string) =>
          channel === IPC_CHANNELS.GET_SITE_CONTENT_STATUS ? { state: 'sort-of-pulled' } : null),
        on: jest.fn(), send: jest.fn(), removeListener: jest.fn(),
      },
    };
    const inst: any = new DockedPanelContainer({ electron });
    spySetState(inst);
    inst.refreshViewedSite();
    await Promise.resolve();
    await Promise.resolve();

    expect(chatProps(inst).siteContext.content).toBeNull();
  });
});

describe('DockedPanelContainer — the chip never outlives the site it describes', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
  });

  it('clears the previous site\'s age the moment the selection moves', async () => {
    setLocalRoute('/main/site-info/site-cedar');
    const { inst } = makeContainer();
    inst.refreshViewedSite();
    await Promise.resolve();
    await Promise.resolve();
    expect(chatProps(inst).siteContext.content).toBeTruthy();

    // Navigating is instantaneous; the read is not. For the length of that round
    // trip the band names the new site, so cedar's age must already be gone —
    // "Currently in: alpine-outfitters" over "Pulled from the live site 11 days
    // ago" would be a confident wrong answer about a site nobody asked about.
    setLocalRoute('/main/site-info/site-nobody-knows');
    inst.refreshViewedSite();
    expect(chatProps(inst).siteContext.content).toBeNull();
  });
});
