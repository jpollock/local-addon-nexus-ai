/**
 * WP-08 · ConstraintRegistry — the in-memory registry the future assembler
 * (WP-11) reads. Built from authored LawDocuments plus constraints derived
 * from live settings; derived entries overlay authored ones by id, recording
 * derivedFrom while keeping the authored (human-reviewed) rule text.
 */
import { ConstraintRegistry } from '../law/registry';
import { Constraint, LawDocument } from '../law/types';

const doc = (over: Partial<LawDocument> = {}): LawDocument => ({
  id: 'pol.test',
  kind: 'policy',
  version: '1.0.0',
  scope: 'tenant',
  path: 'policy/test.md',
  body: '',
  frontmatter: {},
  // WP-20a: the loader stamps these from the raw bytes; a hand-built document
  // carries placeholders, since nothing in this suite reads them.
  hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  canonicalBytes: 0,
  canonicalText: '',
  constraints: [
    {
      id: 'c.gateway-rule',
      rule: 'Writes are denied unless granted.',
      enforcement: 'gateway',
      origin: 'expertise',
      docId: 'pol.test',
      docVersion: '1.0.0',
      scope: 'tenant',
    },
    {
      id: 'c.ambient-rule',
      rule: 'Facts carry their source.',
      enforcement: 'ambient',
      origin: 'intent',
      docId: 'pol.test',
      docVersion: '1.0.0',
      scope: 'tenant',
    },
  ],
  ...over,
});

const derived = (over: Partial<Constraint> = {}): Constraint => ({
  id: 'c.gateway-rule',
  rule: 'generated mirror text',
  enforcement: 'gateway',
  origin: 'expertise',
  docId: 'settings.wpeOperationPermissions',
  docVersion: 'live',
  scope: 'tenant',
  derivedFrom: 'wpeOperationPermissions',
  parameters: { wpcli_production: false },
  ...over,
});

describe('ConstraintRegistry', () => {
  it('serves authored constraints by id and by enforcement filter', () => {
    const reg = ConstraintRegistry.build({ documents: [doc()] });

    expect(reg.byId('c.gateway-rule')?.rule).toBe('Writes are denied unless granted.');
    expect(reg.byId('c.nope')).toBeUndefined();
    expect(reg.constraints({ enforcement: 'gateway' }).map((c) => c.id)).toEqual(['c.gateway-rule']);
    expect(reg.constraints({ enforcement: 'ambient' }).map((c) => c.id)).toEqual(['c.ambient-rule']);
    expect(reg.constraints()).toHaveLength(2);
  });

  it('overlays a derived constraint onto its authored counterpart: authored rule text is kept, derivedFrom and parameters attach', () => {
    const reg = ConstraintRegistry.build({ documents: [doc()], derived: [derived()] });

    const c = reg.byId('c.gateway-rule');
    expect(c?.rule).toBe('Writes are denied unless granted.'); // reviewed law text wins
    expect(c?.derivedFrom).toBe('wpeOperationPermissions');
    expect(c?.parameters).toEqual({ wpcli_production: false });
    expect(reg.constraints()).toHaveLength(2); // overlay, not append
  });

  it('appends a derived constraint that has no authored counterpart', () => {
    const extra = derived({ id: 'c.permissions-mirror', rule: 'full mirror' });
    const reg = ConstraintRegistry.build({ documents: [doc()], derived: [extra] });

    expect(reg.constraints()).toHaveLength(3);
    expect(reg.byId('c.permissions-mirror')?.rule).toBe('full mirror');
  });

  it('filters by derivedFrom so the mirror subset is retrievable on its own', () => {
    const reg = ConstraintRegistry.build({
      documents: [doc()],
      derived: [derived(), derived({ id: 'c.permissions-mirror' })],
    });

    expect(
      reg.constraints({ derivedFrom: 'wpeOperationPermissions' }).map((c) => c.id).sort()
    ).toEqual(['c.gateway-rule', 'c.permissions-mirror']);
  });

  it('lists document metadata without exposing bodies', () => {
    const reg = ConstraintRegistry.build({ documents: [doc()] });

    expect(reg.documents()).toEqual([
      { id: 'pol.test', kind: 'policy', version: '1.0.0', scope: 'tenant', path: 'policy/test.md' },
    ]);
  });
});
