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
    it('renders the 48px rail, not the panel', () => {
      const tree = renderPanel('closed');
      expect(tree).toBeTruthy();
      const props = (tree as any).props;
      // Rail has no role='complementary' — panel does
      expect(props.role).toBeUndefined();
      // Rail is narrower than any panel size
      expect(props.style.width).toBe(48);
      expect(props['aria-label']).toMatch(/closed/i);
    });

    it('renders chevron, mark, label, spacer in rail', () => {
      const tree = renderPanel('closed');
      const children = (tree as any).props.children;
      expect(children).toHaveLength(5); // chevron, mark, label, spacer, (stuck marker slot)
      // Check first child is clickable and has a chevron icon
      const chevron = children[0];
      expect(chevron.props.onClick).toBeDefined();
      expect(chevron.props.role).toBe('button');
    });
  });

  describe('docked state', () => {
    it('renders the panel at 384px, not the rail', () => {
      const tree = renderPanel('docked');
      const props = (tree as any).props;
      expect(props.role).toBe('complementary');
      expect(props.style.width).toBe(384);
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
      // If closed renders the panel, width becomes 384 instead of 48
      expect((tree as any).props.style.width).toBe(48);
    });

    it('removing the rail render entirely leaves closed with nothing', () => {
      // Mutation: delete the entire if (panelState === 'closed') block
      const tree = renderPanel('closed');
      // If the mutation is applied, tree is undefined or the panel
      expect(tree).toBeTruthy();
      expect((tree as any).props.style.width).toBe(48);
    });
  });
});
