import { buildFleetSnapshotForInstructions } from '../../../src/main/mcp/instructions/resources/index';

function makeStorage(opts: {
  externalRows?: Array<{ name: string; environment: string | null }>;
} = {}) {
  const { externalRows = [] } = opts;
  const data: Record<string, unknown> = {};
  return {
    get: jest.fn((key: string) => data[key]),
    set: jest.fn((key: string, val: unknown) => { data[key] = val; }),
    __externalRows: externalRows,
  };
}

function makeGraphService(externalRows: Array<{ name: string; environment: string | null }>) {
  return {
    getDb: () => ({
      prepare: () => ({ all: () => externalRows }),
    }),
  } as any;
}

describe('buildFleetSnapshotForInstructions — external hosts', () => {
  it('includes registered external hosts in the snapshot', () => {
    const storage = makeStorage() as any;
    const graphService = makeGraphService([{ name: 'hostinger-test', environment: 'production' }]);

    const snapshot = buildFleetSnapshotForInstructions(storage, graphService);

    expect(snapshot).not.toBeNull();
    expect(snapshot).toContain('hostinger-test');
  });

  it('does not crash when graphService is undefined', () => {
    const storage = makeStorage() as any;

    const snapshot = buildFleetSnapshotForInstructions(storage, undefined);

    // Whatever it returns for the no-data case today, it must not throw.
    expect(() => buildFleetSnapshotForInstructions(storage, undefined)).not.toThrow();
  });
});
