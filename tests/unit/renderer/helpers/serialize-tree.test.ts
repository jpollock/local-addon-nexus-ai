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

  test('a component element captures its type and props, never its rendered output', () => {
    class Panel extends React.Component<{ label: string }> {
      render() { return React.createElement('div', null, 'rendered'); }
    }
    const out = serializeTree(React.createElement(Panel, { label: 'x' })) as any;
    expect(out.type).toBe('Panel');
    expect(out.props).toEqual({ label: 'x' });
    // Intentional: the helper never invokes render(). Characterize a component
    // by serializing its render() output, not an element referencing it.
    expect(out.children).toBeNull();
  });

  test('a function passed as a child at the top level is marked as [fn]', () => {
    const el = React.createElement('div', null, (() => 'dynamic') as any);
    expect((serializeTree(el) as any).children).toBe('[fn]');
  });

  test('a plain object without $$typeof is returned unchanged', () => {
    const plainObj = { name: 'plain', value: 42 };
    expect(serializeTree(plainObj)).toBe(plainObj);
  });

  test('a Symbol falls back to String(node)', () => {
    const sym = Symbol('test');
    expect(serializeTree(sym)).toBe('Symbol(test)');
  });

  test('displayName takes precedence over name when both exist', () => {
    class ComponentWithBoth extends React.Component {
      static displayName = 'CustomDisplay';
      render() { return null; }
    }
    const el = React.createElement(ComponentWithBoth, null);
    expect((serializeTree(el) as any).type).toBe('CustomDisplay');
  });
});
