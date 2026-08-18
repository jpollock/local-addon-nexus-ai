/**
 * WP-20a · RunbookRegistry — the procedure index 20b (arming/grants) and 20c
 * (delivery) read.
 *
 * Three rules govern every case below, and they are the packet's whole content:
 *
 *  1. **A refusal is recorded, never thrown, and never silent.** The loader's
 *     WP-08 discipline extended to the runbook contract: a runbook that cannot
 *     be honoured is refused with a reason, its siblings still load, and the
 *     policy set is untouched (they share `loadLawDirectory`).
 *  2. **An undeclared checkpoint is NARRATIVE.** `attest` is what lets the UI
 *     distinguish a checkpoint the platform proved from one it merely heard
 *     about (design note §4, §7 / P4, P7). Defaulting an undeclared checkpoint
 *     to anything verifiable would render a green tick over a claim nobody
 *     checked — a false verification claim, manufactured by a default.
 *  3. **The ceiling REFUSES; it never trims.** §6.2 forbids trimming a
 *     procedure, so the only honest answer to an over-size runbook is to
 *     decline to load it and say why (design note §3, ADR-17 third amendment).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadLawDirectory } from '../law/loader';
import {
  RunbookRegistry,
  RUNBOOK_NEAR_CEILING_BYTES,
  STRICT_RUNBOOK_CEILING_BYTES,
} from '../law/runbookRegistry';

/** A strict runbook with the minimum ADR-17 contract: capability + ordered checkpoints. */
const STRICT = `---
id: rb.test-strict
kind: runbook
version: 1.0.0
capability: cap.test
strictness: strict
checkpoints:
  - id: cp.first
  - id: cp.second
---

# Test strict runbook

Prose a human reviewed.
`;

const GUIDED = `---
id: rb.test-guided
kind: runbook
version: 1.0.0
capability: cap.test-guided
strictness: guided
steps:
  - id: st.first
  - id: st.second
---

# Test guided runbook

Prose.
`;

describe('RunbookRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-runbooks-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, content: string) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  /** Build through the REAL loader: hash and byte count are the loader's, not a fixture's. */
  const build = () => {
    const { documents, errors } = loadLawDirectory(dir);
    return { registry: RunbookRegistry.build({ documents }), loaderErrors: errors };
  };

  describe('the typed contract', () => {
    it('loads a strict runbook with its checkpoints in authored order', () => {
      write('runbooks/strict.md', STRICT);

      const { registry, loaderErrors } = build();

      expect(loaderErrors).toEqual([]);
      expect(registry.errors()).toEqual([]);
      const rb = registry.byId('rb.test-strict');
      expect(rb).toBeDefined();
      expect(rb!.capability).toBe('cap.test');
      expect(rb!.strictness).toBe('strict');
      expect(rb!.version).toBe('1.0.0');
      expect(rb!.path).toBe('runbooks/strict.md');
      expect(rb!.checkpoints.map((c) => c.id)).toEqual(['cp.first', 'cp.second']);
    });

    it('keeps the body and the raw frontmatter, which ConstraintRegistry drops', () => {
      write('runbooks/strict.md', STRICT);

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.body).toContain('Prose a human reviewed.');
      expect(rb.frontmatter.capability).toBe('cap.test');
    });

    it('finds a runbook by the capability it serves', () => {
      write('runbooks/strict.md', STRICT);

      expect(build().registry.byCapability('cap.test')?.id).toBe('rb.test-strict');
    });

    it('answers undefined for a capability no loaded runbook serves', () => {
      write('runbooks/strict.md', STRICT);

      expect(build().registry.byCapability('cap.nobody-has-this')).toBeUndefined();
    });

    it('lists runbooks in load order and filters by strictness', () => {
      write('runbooks/a-strict.md', STRICT);
      write('runbooks/b-guided.md', GUIDED);

      const { registry } = build();

      expect(registry.runbooks().map((r) => r.id)).toEqual(['rb.test-strict', 'rb.test-guided']);
      expect(registry.runbooks({ strictness: 'guided' }).map((r) => r.id)).toEqual(['rb.test-guided']);
    });

    it('ignores policy documents rather than refusing them', () => {
      write('policy/ops.md', '---\nid: pol.ops\nkind: policy\nversion: 1.0.0\n---\nProse.\n');
      write('runbooks/strict.md', STRICT);

      const { registry } = build();

      expect(registry.runbooks().map((r) => r.id)).toEqual(['rb.test-strict']);
      expect(registry.errors()).toEqual([]);
    });
  });

  describe('attest — the field a false verification claim would come from', () => {
    it('defaults an undeclared checkpoint to narrative, never to a verifiable class', () => {
      write('runbooks/strict.md', STRICT);

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints.map((c) => c.attest)).toEqual(['narrative', 'narrative']);
    });

    it('round-trips a declared attest class and its evidence selector', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace(
          '  - id: cp.second',
          [
            '  - id: cp.second',
            '    attest: event',
            '    evidence: { topic: task.rationale.recorded, decision: approved, per_target: true }',
          ].join('\n')
        )
      );

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints[1].attest).toBe('event');
      expect(rb.checkpoints[1].evidence).toEqual({
        topic: 'task.rationale.recorded',
        decision: 'approved',
        perTarget: true,
      });
    });

    it('accepts manifest attestation without an evidence topic (the assembler is the witness)', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    attest: manifest')
      );

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints[1].attest).toBe('manifest');
      expect(rb.checkpoints[1].evidence).toBeUndefined();
    });

    it('refuses a runbook whose event-attested checkpoint names no evidence topic', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    attest: event')
      );

      const { registry } = build();

      expect(registry.byId('rb.test-strict')).toBeUndefined();
      expect(registry.errors()).toHaveLength(1);
      expect(registry.errors()[0].code).toBe('invalid-frontmatter');
      expect(registry.errors()[0].reason).toMatch(/cp\.second/);
      expect(registry.errors()[0].reason).toMatch(/evidence/i);
    });

    it('refuses an attest class outside the three the gateway can act on', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    attest: verified')
      );

      const { registry } = build();

      expect(registry.byId('rb.test-strict')).toBeUndefined();
      expect(registry.errors()[0].reason).toMatch(/attest/);
    });
  });

  describe('unrequested — the field the badge is derived from (WP-28, §5b)', () => {
    it('round-trips an authored unrequested checkpoint', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    unrequested: true')
      );

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints[1].unrequested).toBe(true);
    });

    it('leaves it ABSENT when the runbook authors nothing — silence is never a badge', () => {
      // The conservative default, and the reason the field exists: the uniform
      // rail this packet removed came from a badge no document had asked for.
      // A runbook that says nothing gets no badges, so the defect cannot recur
      // by omission.
      write('runbooks/strict.md', STRICT);

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints.map((c) => c.unrequested)).toEqual([undefined, undefined]);
    });

    it('carries an authored FALSE as authored, distinct from silence', () => {
      // `false` is a reviewer saying "this step is what you asked for"; absence
      // is a document that predates the field. Both render the same today, and
      // collapsing them at the parse would throw away the difference before any
      // later reader could see it.
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    unrequested: false')
      );

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints[1].unrequested).toBe(false);
    });

    it('refuses a non-boolean rather than reading a string as truth', () => {
      // `unrequested: "yes"` is truthy in JavaScript and meaningless in the
      // contract. A field that decides what a human is told about a step they
      // did not ask for may not be typo-tolerant.
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    unrequested: "yes"')
      );

      const { registry } = build();

      expect(registry.byId('rb.test-strict')).toBeUndefined();
      expect(registry.errors()[0].code).toBe('invalid-frontmatter');
      expect(registry.errors()[0].reason).toMatch(/unrequested/);
    });
  });

  describe('the contract a strict runbook must carry (ADR-17)', () => {
    it('refuses a strict runbook that enumerates no checkpoints', () => {
      write('runbooks/strict.md', STRICT.replace(/checkpoints:\n( {2}- id: .*\n)+/, ''));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/checkpoint/i);
    });

    it('refuses a guided runbook that claims checkpoints — the word is reserved for strict', () => {
      write('runbooks/guided.md', GUIDED.replace('steps:', 'checkpoints:'));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/checkpoint/i);
      expect(registry.errors()[0].reason).toMatch(/guided/);
    });

    it('keeps a guided runbook’s steps typed and its checkpoint list empty', () => {
      write('runbooks/guided.md', GUIDED);

      const rb = build().registry.byId('rb.test-guided')!;

      expect(rb.steps).toEqual(['st.first', 'st.second']);
      expect(rb.checkpoints).toEqual([]);
    });

    it('refuses a runbook whose checkpoint ids are not unique — sequencing needs identity', () => {
      write('runbooks/strict.md', STRICT.replace('  - id: cp.second', '  - id: cp.first'));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/cp\.first/);
    });

    it('refuses a runbook that declares no capability — a grant has nothing to pin it to', () => {
      write('runbooks/strict.md', STRICT.replace('capability: cap.test\n', ''));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/capability/);
    });

    it('refuses an unknown strictness rather than guessing which ceremony applies', () => {
      write('runbooks/strict.md', STRICT.replace('strictness: strict', 'strictness: firm'));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/strictness/);
    });

    it('refuses a second runbook claiming an already-served capability, keeping the first', () => {
      write('runbooks/a-first.md', STRICT.replace('rb.test-strict', 'rb.first'));
      write('runbooks/b-second.md', STRICT.replace('rb.test-strict', 'rb.second'));

      const { registry } = build();

      expect(registry.byCapability('cap.test')?.id).toBe('rb.first');
      expect(registry.errors()).toHaveLength(1);
      expect(registry.errors()[0].code).toBe('duplicate-capability');
      expect(registry.errors()[0].path).toBe('runbooks/b-second.md');
      expect(registry.errors()[0].reason).toMatch(/rb\.first/);
    });
  });

  describe('tools and tool_scope', () => {
    it('parses a bare tool name and an object entry carrying its lifecycle constraint', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace(
          'checkpoints:',
          [
            'tools:',
            '  - wp_plugin_list',
            '  - { name: bulk_plugin_update, mode: live, no_auto_start: true }',
            'checkpoints:',
          ].join('\n')
        )
      );

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.tools).toEqual([
        { name: 'wp_plugin_list' },
        { name: 'bulk_plugin_update', mode: 'live', noAutoStart: true },
      ]);
    });

    it('carries a per-checkpoint tool list, so the sequencer can claim a call', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace('  - id: cp.second', '  - id: cp.second\n    tools: [bulk_plugin_update]')
      );

      const rb = build().registry.byId('rb.test-strict')!;

      expect(rb.checkpoints[1].tools).toEqual([{ name: 'bulk_plugin_update' }]);
      expect(rb.checkpoints[0].tools).toEqual([]);
    });

    it('defaults tool_scope to advisory — v0 grants disclose tools, they do not filter them', () => {
      write('runbooks/strict.md', STRICT);

      expect(build().registry.byId('rb.test-strict')!.toolScope).toBe('advisory');
    });

    it('round-trips the exclusive scope that ships as mechanism only', () => {
      write('runbooks/strict.md', STRICT.replace('strictness: strict', 'strictness: strict\ntool_scope: exclusive'));

      expect(build().registry.byId('rb.test-strict')!.toolScope).toBe('exclusive');
    });

    it('refuses an unknown tool_scope rather than silently treating it as advisory', () => {
      write('runbooks/strict.md', STRICT.replace('strictness: strict', 'strictness: strict\ntool_scope: closed'));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/tool_scope/);
    });
  });

  describe('arms_on — the predicate 20b evaluates', () => {
    it('round-trips both authored clauses', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace(
          'checkpoints:',
          'arms_on:\n  verbs: [update, bump]\n  subjects: [plugin, woocommerce]\ncheckpoints:'
        )
      );

      expect(build().registry.byId('rb.test-strict')!.armsOn).toEqual({
        verbs: ['update', 'bump'],
        subjects: ['plugin', 'woocommerce'],
      });
    });

    it('leaves armsOn undefined when the runbook declares no predicate', () => {
      write('runbooks/strict.md', STRICT);

      expect(build().registry.byId('rb.test-strict')!.armsOn).toBeUndefined();
    });

    it('refuses a predicate with an empty clause — it would match everything or nothing', () => {
      write(
        'runbooks/strict.md',
        STRICT.replace('checkpoints:', 'arms_on:\n  verbs: []\n  subjects: [plugin]\ncheckpoints:')
      );

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()[0].reason).toMatch(/arms_on/);
    });
  });

  describe('the ceiling', () => {
    /** Pad the prose body so the whole document measures exactly `bytes`. */
    const sizedStrict = (bytes: number) => {
      const base = STRICT;
      const pad = bytes - Buffer.byteLength(base, 'utf8');
      expect(pad).toBeGreaterThanOrEqual(0);
      return base + 'x'.repeat(pad);
    };

    it('loads a strict runbook measuring exactly the ceiling', () => {
      write('runbooks/strict.md', sizedStrict(STRICT_RUNBOOK_CEILING_BYTES));

      const { registry } = build();

      expect(registry.errors()).toEqual([]);
      expect(registry.byId('rb.test-strict')!.canonicalBytes).toBe(STRICT_RUNBOOK_CEILING_BYTES);
    });

    it('refuses a strict runbook one byte over the ceiling', () => {
      write('runbooks/strict.md', sizedStrict(STRICT_RUNBOOK_CEILING_BYTES + 1));

      const { registry } = build();

      expect(registry.byId('rb.test-strict')).toBeUndefined();
      expect(registry.errors()).toHaveLength(1);
      expect(registry.errors()[0].code).toBe('over-ceiling');
    });

    it('names the ceiling, the measured size and the split remedy in the refusal', () => {
      write('runbooks/strict.md', sizedStrict(STRICT_RUNBOOK_CEILING_BYTES + 1));

      const reason = build().registry.errors()[0].reason;

      expect(reason).toContain(String(STRICT_RUNBOOK_CEILING_BYTES));
      expect(reason).toContain(String(STRICT_RUNBOOK_CEILING_BYTES + 1));
      expect(reason).toMatch(/split/i);
      // Refusal, not trimming: the reason must not offer a truncated procedure.
      expect(reason).not.toMatch(/trim|truncat/i);
    });

    it('warns, and still loads, one byte past the 90% line', () => {
      write('runbooks/strict.md', sizedStrict(RUNBOOK_NEAR_CEILING_BYTES + 1));

      const { registry } = build();

      // Loaded — a warning is not a refusal, and conflating them would make the
      // margin report indistinguishable from a failure.
      expect(registry.byId('rb.test-strict')).toBeDefined();
      expect(registry.errors()).toEqual([]);
      expect(registry.warnings()).toHaveLength(1);
      expect(registry.warnings()[0]).toMatchObject({
        runbookId: 'rb.test-strict',
        code: 'near-ceiling',
        path: 'runbooks/strict.md',
      });
      // The number an author acts on is the REMAINING margin, not the size.
      expect(registry.warnings()[0].reason).toContain(
        String(STRICT_RUNBOOK_CEILING_BYTES - RUNBOOK_NEAR_CEILING_BYTES - 1)
      );
    });

    it('is silent exactly ON the 90% line — the warning is for past it', () => {
      write('runbooks/strict.md', sizedStrict(RUNBOOK_NEAR_CEILING_BYTES));

      expect(build().registry.warnings()).toEqual([]);
    });

    it('does not warn about a guided runbook — it has no margin to spend', () => {
      const base = GUIDED;
      const pad = RUNBOOK_NEAR_CEILING_BYTES + 1 - Buffer.byteLength(base, 'utf8');
      write('runbooks/guided.md', base + 'x'.repeat(pad));

      const { registry } = build();

      expect(registry.byId('rb.test-guided')).toBeDefined();
      expect(registry.warnings()).toEqual([]);
    });

    it('refuses an over-ceiling runbook WITHOUT also warning about it', () => {
      // Two reports of one document would read as two documents, and the
      // refusal is the louder, truer one.
      write('runbooks/strict.md', sizedStrict(STRICT_RUNBOOK_CEILING_BYTES + 1));

      const { registry } = build();

      expect(registry.errors()).toHaveLength(1);
      expect(registry.warnings()).toEqual([]);
    });

    it('does not apply the ceiling to a guided runbook (the ruled scope is strict)', () => {
      const base = GUIDED;
      const pad = STRICT_RUNBOOK_CEILING_BYTES + 1 - Buffer.byteLength(base, 'utf8');
      write('runbooks/guided.md', base + 'x'.repeat(pad));

      const { registry } = build();

      expect(registry.errors()).toEqual([]);
      expect(registry.byId('rb.test-guided')!.canonicalBytes).toBe(STRICT_RUNBOOK_CEILING_BYTES + 1);
    });

    it('measures the whole document, not the prose body alone', () => {
      // A document whose BODY is small but whose frontmatter contract is huge is
      // still a huge procedure: checkpoints, aborts and communication
      // obligations all live in the frontmatter and all ride the turn.
      const fat = STRICT.replace(
        '  - id: cp.second',
        `  - id: cp.second\n# ${'y'.repeat(STRICT_RUNBOOK_CEILING_BYTES)}`
      );
      write('runbooks/strict.md', fat);

      const { registry } = build();

      expect(registry.errors()[0].code).toBe('over-ceiling');
    });
  });

  describe('the content hash a grant pins', () => {
    const hashOfFile = (content: string) => {
      write('runbooks/pinned.md', content);
      return build().registry.byId('rb.test-strict')!.hash;
    };

    it('reproduces the same pin from the same bytes', () => {
      expect(hashOfFile(STRICT)).toBe(hashOfFile(STRICT));
    });

    it('changes when a single character of reviewed prose changes', () => {
      expect(hashOfFile(STRICT.replace('reviewed.', 'reviewed!'))).not.toBe(hashOfFile(STRICT));
    });

    it('changes when the frontmatter contract changes but the body does not', () => {
      // The pin must cover the contract, not just the prose: a checkpoint added
      // to the frontmatter is a different reviewed procedure.
      expect(hashOfFile(STRICT.replace('  - id: cp.second', '  - id: cp.second\n  - id: cp.third'))).not.toBe(
        hashOfFile(STRICT)
      );
    });

    it('is identical for CRLF and LF copies of the same runbook', () => {
      expect(hashOfFile(STRICT.replace(/\n/g, '\r\n'))).toBe(hashOfFile(STRICT));
    });

    it('measures the same canonical text the ceiling does, so CRLF cannot change either', () => {
      write('runbooks/pinned.md', STRICT.replace(/\n/g, '\r\n'));
      const crlfBytes = build().registry.byId('rb.test-strict')!.canonicalBytes;
      write('runbooks/pinned.md', STRICT);

      expect(crlfBytes).toBe(build().registry.byId('rb.test-strict')!.canonicalBytes);
    });

    it('is a sha256 hex digest, prefixed with the algorithm that produced it', () => {
      write('runbooks/strict.md', STRICT);

      expect(build().registry.byId('rb.test-strict')!.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('non-fatality — the seam invariant', () => {
    it('refuses one runbook without disturbing its siblings', () => {
      write('runbooks/a-good.md', STRICT);
      write('runbooks/b-bad.md', GUIDED.replace('strictness: guided', 'strictness: firm'));

      const { registry } = build();

      expect(registry.runbooks().map((r) => r.id)).toEqual(['rb.test-strict']);
      expect(registry.errors()).toHaveLength(1);
    });

    it('a refused runbook does not take out the policy set they share a loader with', () => {
      write(
        'policy/ops.md',
        [
          '---',
          'id: pol.ops',
          'kind: policy',
          'version: 1.0.0',
          'constraints:',
          '  - id: c.no-prod-writes',
          '    rule: Production writes are denied unless granted.',
          '    enforcement: gateway',
          '    origin: expertise',
          '---',
          'Prose.',
          '',
        ].join('\n')
      );
      write('runbooks/bad.md', STRICT.replace('capability: cap.test\n', ''));

      const { documents, errors } = loadLawDirectory(dir);
      const registry = RunbookRegistry.build({ documents });

      expect(errors).toEqual([]); // the loader loaded both documents
      expect(documents.map((d) => d.id)).toEqual(['pol.ops', 'rb.test-strict']);
      expect(registry.errors()).toHaveLength(1); // the runbook contract is what refused it
      expect(registry.runbooks()).toEqual([]);
    });

    it('records a reason instead of throwing when a contract field is the wrong shape entirely', () => {
      write('runbooks/strict.md', STRICT.replace(/checkpoints:\n( {2}- id: .*\n)+/, 'checkpoints: nope\n'));
      write('runbooks/other.md', GUIDED.replace('steps:\n  - id: st.first\n  - id: st.second\n', 'steps: 7\n'));

      const { registry } = build();

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors().map((e) => e.code)).toEqual(['invalid-frontmatter', 'invalid-frontmatter']);
    });

    it('builds an empty registry from no documents at all', () => {
      const registry = RunbookRegistry.build({ documents: [] });

      expect(registry.runbooks()).toEqual([]);
      expect(registry.errors()).toEqual([]);
      expect(registry.byId('rb.anything')).toBeUndefined();
    });
  });
});
