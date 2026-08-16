/**
 * ConstraintRegistry — the in-memory constraint registry (WP-08).
 *
 * Built once from authored LawDocuments plus constraints derived from live
 * settings. Derived entries OVERLAY authored ones by id: the authored
 * (human-reviewed) rule text is kept, the derived entry contributes its
 * derivedFrom marker and live parameters. A derived constraint with no
 * authored counterpart is appended — that is how registry-only records like
 * c.permissions-mirror exist without being law anyone reviewed as prose.
 *
 * The lookup surface is deliberately small and read-only: this is what the
 * future context assembler (WP-11) consumes.
 */
import { Constraint, ConstraintOrigin, Enforcement, LawDocument } from './types';

export interface ConstraintFilter {
  enforcement?: Enforcement;
  origin?: ConstraintOrigin;
  docId?: string;
  /** Match constraints derived from a named settings surface. */
  derivedFrom?: string;
}

export type LawDocumentMeta = Pick<LawDocument, 'id' | 'kind' | 'version' | 'scope' | 'path'>;

export class ConstraintRegistry {
  private readonly ordered: Constraint[] = [];
  private readonly index = new Map<string, Constraint>();
  private readonly docs: LawDocumentMeta[] = [];

  private constructor() {}

  static build(opts: { documents: LawDocument[]; derived?: Constraint[] }): ConstraintRegistry {
    const reg = new ConstraintRegistry();
    for (const doc of opts.documents) {
      reg.docs.push({ id: doc.id, kind: doc.kind, version: doc.version, scope: doc.scope, path: doc.path });
      for (const c of doc.constraints) {
        reg.index.set(c.id, c);
        reg.ordered.push(c);
      }
    }
    for (const d of opts.derived ?? []) {
      const authored = reg.index.get(d.id);
      if (authored) {
        // Reviewed law text wins; the derived entry attaches its provenance
        // and live values. Replace in place so ordering is stable.
        const merged: Constraint = { ...authored, derivedFrom: d.derivedFrom, parameters: d.parameters };
        reg.index.set(d.id, merged);
        reg.ordered[reg.ordered.indexOf(authored)] = merged;
      } else {
        reg.index.set(d.id, d);
        reg.ordered.push(d);
      }
    }
    return reg;
  }

  byId(id: string): Constraint | undefined {
    return this.index.get(id);
  }

  constraints(filter?: ConstraintFilter): Constraint[] {
    return this.ordered.filter(
      (c) =>
        (!filter?.enforcement || c.enforcement === filter.enforcement) &&
        (!filter?.origin || c.origin === filter.origin) &&
        (!filter?.docId || c.docId === filter.docId) &&
        (!filter?.derivedFrom || c.derivedFrom === filter.derivedFrom)
    );
  }

  documents(): LawDocumentMeta[] {
    return [...this.docs];
  }
}
