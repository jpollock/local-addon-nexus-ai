/**
 * WP-20c · the split of the two over-ceiling strict runbooks — conservation.
 *
 * `rb.incident-response` (15,853 canonical bytes) and `rb.staging-promotion`
 * (10,453) could not be delivered whole, and §6.2 forbids delivering a
 * procedure in part, so the WP-20 phase-1 ruling split them. A split that loses
 * an abort path or a communication obligation is not a split, it is a rewrite —
 * so the contract of each original is transcribed here, from the documents as
 * they stood at `a580025c`, and the union of the parts is checked against it.
 *
 * The transcription is a literal on purpose. It is frozen history: the
 * pre-split documents no longer exist in the tree, so there is nothing left for
 * it to drift against, and deriving it from the parts would make the test agree
 * with itself.
 */
import * as path from 'path';
import { loadLawDirectory } from '../law/loader';
import { RunbookRegistry, STRICT_RUNBOOK_CEILING_BYTES } from '../law/runbookRegistry';
import { Runbook } from '../law/types';

const LAW_DIR = path.join(path.resolve(__dirname, '..', '..', '..'), 'law');

/** The pre-split contracts, transcribed from the documents at a580025c. */
const ORIGINALS = {
  'rb.incident-response': {
    checkpoints: [
      'cp.triage', 'cp.isolate', 'cp.snapshot', 'cp.integrity-diff', 'cp.entry-vector',
      'cp.cleanup-plan', 'cp.approval', 'cp.execute-cleanup', 'cp.rotate-credentials',
      'cp.verify-clean', 'cp.post-mortem',
    ],
    aborts: [
      'ab.evidence-not-preserved', 'ab.grant-refused', 'ab.client-red-line',
      'ab.entry-vector-unknown', 'ab.reinfection', 'ab.scope-wider-than-one-site',
    ],
    communication: [
      'the findings, ranked by severity, each with its evidence (path, account name, log line)',
      'what isolation was applied, when, and what it makes unavailable to real visitors',
      'the snapshot id(s) and their verification status, before any cleanup runs',
      'the exact commands proposed, shown in full, BEFORE approval is requested',
      'the entry-vector hypothesis with the log evidence it rests on — or an explicit statement that the entry vector is unknown',
      'which credentials were rotated and the consequences (sessions invalidated, users logged out, integrations needing re-authentication)',
      'the blind spots this investigation cannot see — runtime behaviour and premium/paid component internals — stated in the post-mortem, not omitted because the news is good',
      'anything left uncleaned because a permission was refused, named as such',
    ],
    parts: ['rb.incident-containment', 'rb.incident-remediation'],
  },
  'rb.staging-promotion': {
    checkpoints: [
      'cp.resolve-endpoints', 'cp.grant-check', 'cp.consult-history', 'cp.preflight-diff',
      'cp.backup', 'cp.approval', 'cp.promote', 'cp.verify-destination', 'cp.report',
    ],
    aborts: [
      'ab.direction-ambiguous', 'ab.grant-denied', 'ab.backup-failed',
      'ab.approval-denied', 'ab.promotion-failed',
    ],
    communication: [
      'the resolved source and destination, each with its environment label, before anything runs',
      'that promotion OVERWRITES the destination, stated before approval is requested',
      'what the pre-flight diff showed (what is about to be replaced)',
      'the destination backup id and its verification status',
      'anything cp.consult-history surfaced about these two environments',
      'the post-promotion verification result, or that verification could not be completed',
    ],
    parts: ['rb.promotion-preflight', 'rb.promotion-execute'],
  },
};

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

function registry(): RunbookRegistry {
  return RunbookRegistry.build({ documents: loadLawDirectory(LAW_DIR).documents });
}

function idsOf(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.map((e) => (typeof e === 'string' ? e : String((e as { id?: string }).id)))
    : [];
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string').map(flat) : [];
}

describe.each(Object.entries(ORIGINALS))('%s, split', (originalId, original) => {
  const parts = (): Runbook[] => {
    const reg = registry();
    return original.parts.map((id) => {
      const rb = reg.byId(id);
      if (!rb) throw new Error(`${id} is not served by the registry`);
      return rb;
    });
  };

  it('is gone from the tree, replaced by its parts', () => {
    const reg = registry();
    expect(reg.byId(originalId)).toBeUndefined();
    expect(parts().map((p) => p.id)).toEqual(original.parts);
  });

  it('conserves every checkpoint, once, in the original order', () => {
    const union = parts().flatMap((p) => p.checkpoints.map((c) => c.id));

    expect(union).toEqual(original.checkpoints);
    expect(new Set(union).size).toBe(original.checkpoints.length);
  });

  it('conserves every abort path', () => {
    const union = parts().flatMap((p) => idsOf(p.frontmatter.aborts));

    expect(union.slice().sort()).toEqual(original.aborts.slice().sort());
  });

  it('conserves every communication obligation, verbatim', () => {
    // Verbatim because these are the facts a user must be TOLD; a reworded
    // obligation is a different obligation, and the eval checks quote them.
    const union = parts().flatMap((p) => strings(p.frontmatter.communication));

    expect(union.slice().sort()).toEqual(original.communication.map(flat).slice().sort());
  });

  it('splits into parts that are each strict, each servable, and each under the ceiling', () => {
    for (const part of parts()) {
      expect({ id: part.id, strictness: part.strictness }).toEqual({
        id: part.id,
        strictness: 'strict',
      });
      expect(part.canonicalBytes).toBeLessThanOrEqual(STRICT_RUNBOOK_CEILING_BYTES);
      // Each part carries its own capability: a grant is per capability, and
      // two halves under one capability would arm the whole thing again.
      expect(part.capability).toMatch(/^cap\./);
    }
    const capabilities = parts().map((p) => p.capability);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });

  it('says which document it came from, and which sibling it runs beside', () => {
    // The seam is a fact about the procedure, not a detail of how it was
    // edited: an actor handed half a procedure must be able to find the half it
    // was not handed.
    for (const part of parts()) {
      expect(part.frontmatter.split_from).toBe(originalId);
    }
    const [first, second] = parts();
    expect([first.frontmatter.hands_off_to, second.frontmatter.follows]).toEqual([
      second.id,
      first.id,
    ]);
  });
});

describe('cross-references follow the split', () => {
  it('no runbook points at a document that no longer exists', () => {
    const reg = registry();
    const served = new Set(reg.runbooks().map((r) => r.id));

    for (const rb of reg.runbooks()) {
      const referenced = rb.canonicalText.match(/\brb\.[a-z0-9-]+/g) ?? [];
      for (const ref of referenced) {
        if (ref === rb.id) continue;
        // `split_from:` names the document this one replaced — the one
        // reference that is SUPPOSED to point at something gone.
        if (ref === rb.frontmatter.split_from) continue;
        expect({ from: rb.id, to: ref, served: served.has(ref) }).toEqual({
          from: rb.id,
          to: ref,
          served: true,
        });
      }
    }
  });
});
