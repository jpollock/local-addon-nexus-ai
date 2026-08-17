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

function makeElectron() {
  const invoke = jest.fn(async (channel: string) => {
    if (channel === IPC_CHANNELS.GET_SITES) {
      return [
        { id: 'site-cedar', name: 'cedarvale' },
        { id: 'site-alpine', name: 'alpine-outfitters' },
      ];
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
