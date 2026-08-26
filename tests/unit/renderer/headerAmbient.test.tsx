/**
 * fixes-082526 · new-chat header board — the needs-you count's only home.
 *
 * The queue verdict was removed from the chat's opening (16:09 ruling): the
 * count is "available as a door at ambient weight in the header, where it
 * cannot be mistaken for the subject". This suite pins that home:
 *
 *  - stage (full): the line and the door — "9 things need you · Open Now"
 *  - companion (docked): the door alone — a 380px header has no room for both
 *  - in a conversation, or with nothing waiting, or count unknown: nothing —
 *    an ambient line for zero is noise, and a count we do not have is
 *    withheld, never guessed
 *
 * Identity, same commit: the mark paints the design's radial gradient with
 * the white orbit glyph, and the wordmark reads "Nexus AI" (the design's
 * name in all three boards).
 */
import React from 'react';
import { DockedPanel, type PanelState } from '../../../src/renderer/components/DockedPanel/DockedPanel';
import { deriveAmbient } from '../../../src/renderer/components/DockedPanel/headerAmbient';

const noop = () => {};

function walk(node: any, out: any[] = []): any[] {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  out.push(node);
  const kids = node?.props?.children;
  if (kids) walk(Array.isArray(kids) ? kids : [kids], out);
  return out;
}

function textsOf(tree: any): string[] {
  return walk(tree)
    .flatMap((n) => {
      const kids = n?.props?.children;
      const own: string[] = [];
      (Array.isArray(kids) ? kids : [kids]).forEach((k: any) => {
        if (typeof k === 'string') own.push(k);
      });
      return own;
    });
}

function renderPanel(panelState: PanelState, ambient: any) {
  return new DockedPanel({
    panelState,
    onOpen: noop,
    onClose: noop,
    onSetPanelState: noop,
    ambient,
  } as any).render();
}

const AMBIENT = { line: '9 things need you', door: 'Open Now', onOpen: jest.fn() };

describe('the ambient needs-you door', () => {
  it('full (stage): renders the line AND the door', () => {
    const texts = textsOf(renderPanel('full', AMBIENT));
    expect(texts).toContain('9 things need you');
    expect(texts).toContain('Open Now');
  });

  it('docked (companion): renders the door alone — no room for the line', () => {
    const texts = textsOf(renderPanel('docked', AMBIENT));
    expect(texts).not.toContain('9 things need you');
    expect(texts).toContain('Open Now');
  });

  it('no ambient → neither renders', () => {
    const texts = textsOf(renderPanel('full', null));
    expect(texts).not.toContain('Open Now');
    expect(texts.join(' ')).not.toMatch(/need you/);
  });

  it('the door is a button that fires onOpen', () => {
    const onOpen = jest.fn();
    const tree = renderPanel('docked', { ...AMBIENT, onOpen });
    const door = walk(tree).find((n) => {
      const kids = n?.props?.children;
      return (Array.isArray(kids) ? kids : [kids]).includes('Open Now');
    });
    expect(door).toBeTruthy();
    expect(typeof door.props.onClick).toBe('function');
    door.props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('the header identity', () => {
  it('the wordmark reads "Nexus AI"', () => {
    expect(textsOf(renderPanel('docked', null))).toContain('Nexus AI');
  });

  it('the mark paints the design gradient', () => {
    const gradient = walk(renderPanel('docked', null)).find((n) =>
      String(n?.props?.style?.background ?? '').includes('radial-gradient'),
    );
    expect(gradient).toBeTruthy();
  });
});

describe('deriveAmbient — the container-side derivation', () => {
  const open = () => {};
  it('a fresh chat with things waiting: the count-formatted line and the ratified door', () => {
    expect(deriveAmbient(9, null, open)).toMatchObject({ line: '9 things need you', door: 'Open Now' });
  });
  it('one thing: singular, no s-agreement slip', () => {
    expect(deriveAmbient(1, null, open)).toMatchObject({ line: '1 thing needs you' });
  });
  it('zero waiting → null (an ambient line for zero is noise)', () => {
    expect(deriveAmbient(0, null, open)).toBeNull();
  });
  it('count unknown → null (withheld, never guessed)', () => {
    expect(deriveAmbient(null, null, open)).toBeNull();
  });
  it('a conversation in progress → null (board C: the subject has arrived)', () => {
    expect(deriveAmbient(9, 'sess_1', open)).toBeNull();
  });
});
