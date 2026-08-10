import { StorageHealthPanel } from '../../../src/renderer/components/StorageHealthPanel';

function flatten(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join(' ');
  return node.props ? flatten(node.props.children) : '';
}

it('lists Logs as a storage category', () => {
  const p: any = new StorageHealthPanel({ electron: undefined } as any);
  p.state = {
    ...p.state,
    loading: false,
    health: {
      graphDb: { sizeBytes: 1, eventCount: 0, oldestEvent: null, newestEvent: null },
      vectorDb: { sizeBytes: 1, tableCount: 0 },
      logs: { sizeBytes: 12582912 },
      pendingEvents: 0,
      failedEvents: 0,
    },
  };
  expect(flatten(p.render())).toContain('Logs');
});

it('does not break when the logs figure has not loaded', () => {
  const p: any = new StorageHealthPanel({ electron: undefined } as any);
  p.state = {
    ...p.state,
    loading: false,
    health: {
      graphDb: { sizeBytes: 1, eventCount: 0, oldestEvent: null, newestEvent: null },
      vectorDb: { sizeBytes: 1, tableCount: 0 },
      pendingEvents: 0,
      failedEvents: 0,
    },
  };
  expect(() => p.render()).not.toThrow();
});
