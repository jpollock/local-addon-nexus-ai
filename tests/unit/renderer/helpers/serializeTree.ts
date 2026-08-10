/**
 * Serializes a React.createElement tree into a plain, stable, diffable object.
 *
 * Used for characterization snapshots during refactors: the tree is captured
 * without rendering, so no `react-dom` is needed — `react`/`react-dom` are only
 * `peerDependencies: "*"` in this project, resolved from Local's runtime.
 *
 * Deliberately brittle. During a behaviour-preserving refactor ANY structural,
 * prop, style or text change should fail the snapshot.
 *
 * LIMITATION: A component element serializes as its type name and props only,
 * never its rendered output. This is intentional — the helper captures an
 * element tree that has already been built, not one being rendered. To
 * characterize a component's own output, serialize the result of calling its
 * render method directly, not an element referencing it.
 */

function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props).sort()) {
    if (key === 'children') continue;
    const value = props[key];
    if (typeof value === 'function') {
      // Keep the fact that a handler exists, drop its identity.
      out[key] = '[fn]';
    } else if (value && typeof value === 'object' && (value as any).$$typeof) {
      out[key] = serializeTree(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function serializeTree(node: unknown): unknown {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(serializeTree);
  if (typeof node === 'function') return '[fn]';

  if (typeof node === 'object') {
    const el = node as {
      $$typeof?: symbol;
      type?: unknown;
      key?: string | null;
      props?: Record<string, unknown>;
    };

    if (!el.$$typeof) return node;

    const t = el.type;
    const typeName =
      typeof t === 'string'
        ? t
        : ((t as { displayName?: string; name?: string })?.displayName ??
           (t as { name?: string })?.name ??
           'Unknown');

    const props = el.props ?? {};
    const children = (props as { children?: unknown }).children;

    return {
      type: typeName,
      key: el.key ?? null,
      props: serializeProps(props),
      children: children === undefined ? null : serializeTree(children),
    };
  }

  return String(node);
}
