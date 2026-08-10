import * as React from 'react';
import { serializeTree } from './serializeTree';

describe('serializeTree', () => {
  test('captures type, props, style and text children', () => {
    const el = React.createElement('div', { style: { color: 'red' }, id: 'x' }, 'hello');
    expect(serializeTree(el)).toEqual({
      type: 'div',
      key: null,
      props: { style: { color: 'red' }, id: 'x' },
      children: 'hello',
    });
  });

  test('recurses into nested children and preserves order', () => {
    const el = React.createElement('div', null,
      React.createElement('span', { key: 'a' }, 'one'),
      React.createElement('span', { key: 'b' }, 'two'),
    );
    const out = serializeTree(el) as any;
    expect(out.children.map((c: any) => c.children)).toEqual(['one', 'two']);
    expect(out.children.map((c: any) => c.key)).toEqual(['a', 'b']);
  });

  test('replaces functions with a stable marker so a handler appearing or vanishing fails', () => {
    const withHandler = React.createElement('button', { onClick: () => undefined }, 'go');
    const without = React.createElement('button', {}, 'go');
    expect((serializeTree(withHandler) as any).props.onClick).toBe('[fn]');
    expect(serializeTree(withHandler)).not.toEqual(serializeTree(without));
  });

  test('names component types rather than emitting an unstable function reference', () => {
    class Widget extends React.Component { render() { return null; } }
    const el = React.createElement(Widget, null);
    expect((serializeTree(el) as any).type).toBe('Widget');
  });

  test('drops null, undefined and boolean children', () => {
    const el = React.createElement('div', null, null, undefined, false, 'kept');
    expect((serializeTree(el) as any).children).toEqual([null, null, null, 'kept']);
  });
});
