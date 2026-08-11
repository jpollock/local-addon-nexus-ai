import React from 'react';
import { DockedPanel, type PanelState } from '../../../src/renderer/components/DockedPanel/DockedPanel';

describe('DockedPanel — state enum', () => {
  const noop = () => {};
  const mockElectron = { ipcRenderer: { on: jest.fn(), invoke: jest.fn(), send: jest.fn(), removeListener: jest.fn() } };

  function renderPanel(panelState: PanelState) {
    const component = new DockedPanel({
      panelState,
      onOpen: noop,
      onClose: noop,
      onSetPanelState: noop,
    });
    return component.render();
  }

  describe('closed state', () => {
    it('renders the 44px floating tab, not the panel', () => {
      const tree = renderPanel('closed');
      expect(tree).toBeTruthy();
      const props = (tree as any).props;
      // Tab is the control itself, so it carries role='button'; the panel is 'complementary'
      expect(props.role).toBe('button');
      // Tab is narrower than any panel size
      expect(props.style.width).toBe(44);
      expect(props['aria-label']).toMatch(/closed/i);
    });

    it('the whole tab opens the panel — one hit target, not a separate chevron', () => {
      const tree = renderPanel('closed');
      const props = (tree as any).props;
      expect(props.onClick).toBeDefined();
      expect(props.tabIndex).toBe(0);
      const children = (tree as any).props.children;
      expect(children).toHaveLength(3); // mark, label, (stuck marker slot)
    });

    it('does not span the full height — it cannot occupy the header or footer band', () => {
      // This is the regression guard for the clipping bug, and the reason the collapsed
      // state stopped being a full-height rail. A strip pinned top:0/bottom:0 sits across
      // Local's site header and its "Open site" / "WP Admin" actions; reverting to that
      // shape must fail here rather than in a screenshot.
      const style = (renderPanel('closed') as any).props.style;
      expect(style.top).toBe('50%');
      expect(style.transform).toBe('translateY(-50%)');
      expect(style.bottom).toBeUndefined();
      expect(style.height).toBeUndefined();
    });
  });

  describe('docked state', () => {
    it('renders the panel at 380px content width, not the rail', () => {
      const tree = renderPanel('docked');
      const props = (tree as any).props;
      expect(props.role).toBe('complementary');
      expect(props.style.width).toBe(380);
    });

    it('includes the header with segmented control', () => {
      const tree = renderPanel('docked');
      const children = (tree as any).props.children;
      expect(children[0]).toBeTruthy(); // header
      expect(children[1]).toBeTruthy(); // body
    });
  });

  describe('wide state', () => {
    it('renders the panel at 620px', () => {
      const tree = renderPanel('wide');
      expect((tree as any).props.style.width).toBe(620);
    });
  });

  describe('full state', () => {
    it('renders the panel with left: 68, width: undefined', () => {
      const tree = renderPanel('full');
      const style = (tree as any).props.style;
      expect(style.left).toBe(68);
      expect(style.width).toBeUndefined();
    });
  });

  describe('invariant: no state renders neither rail nor panel', () => {
    const allStates: PanelState[] = ['closed', 'docked', 'wide', 'full'];

    allStates.forEach((state) => {
      it(`${state} renders something`, () => {
        const tree = renderPanel(state);
        expect(tree).toBeTruthy();
        expect((tree as any).props).toBeTruthy();
      });
    });
  });

  describe('mutations verified', () => {
    it('changing closed to render panel fails the test', () => {
      // Mutation: make closed render the panel by forcing panelState='docked' inside the check
      const component = new DockedPanel({
        panelState: 'closed',
        onOpen: noop,
        onClose: noop,
        onSetPanelState: noop,
      });
      const tree = component.render();
      // This assertion MUST fail if the mutation is applied:
      // If closed renders the panel, width becomes 380 instead of 44
      expect((tree as any).props.style.width).toBe(44);
    });

    it('removing the tab render entirely leaves closed with nothing', () => {
      // Mutation: delete the entire if (panelState === 'closed') block
      const tree = renderPanel('closed');
      // If the mutation is applied, tree is undefined or the panel
      expect(tree).toBeTruthy();
      expect((tree as any).props.style.width).toBe(44);
    });
  });
});
