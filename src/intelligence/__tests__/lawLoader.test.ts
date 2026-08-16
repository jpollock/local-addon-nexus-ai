/**
 * WP-08 · law/ directory loader — markdown + YAML frontmatter → LawDocuments.
 *
 * The loader is the intake gate of the policy & runbook repo (ADR-5, ADR-17):
 * a malformed document is rejected with a recorded error, never a throw —
 * everything on this seam is non-fatal by construction.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadLawDirectory } from '../law/loader';

const VALID_POLICY = `---
id: pol.test-policy
kind: policy
version: 1.0.0
scope: tenant
owner: ops
constraints:
  - id: c.test-gateway
    rule: Writes are denied unless granted.
    enforcement: gateway
    origin: expertise
  - id: c.test-ambient
    rule: Facts carry their source.
    enforcement: ambient
    origin: intent
---

# Test policy

Prose body reviewed by humans.
`;

describe('loadLawDirectory', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, content: string) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  it('loads a policy document and propagates document identity onto each constraint', () => {
    write('policy/test-policy.md', VALID_POLICY);

    const result = loadLawDirectory(dir);

    expect(result.errors).toEqual([]);
    expect(result.documents).toHaveLength(1);
    const doc = result.documents[0];
    expect(doc.id).toBe('pol.test-policy');
    expect(doc.kind).toBe('policy');
    expect(doc.version).toBe('1.0.0');
    expect(doc.scope).toBe('tenant');
    expect(doc.path).toBe('policy/test-policy.md');
    expect(doc.body).toContain('Prose body reviewed by humans.');
    expect(doc.constraints).toHaveLength(2);
    expect(doc.constraints[0]).toMatchObject({
      id: 'c.test-gateway',
      rule: 'Writes are denied unless granted.',
      enforcement: 'gateway',
      origin: 'expertise',
      docId: 'pol.test-policy',
      docVersion: '1.0.0',
      scope: 'tenant',
    });
    expect(doc.constraints[1].enforcement).toBe('ambient');
  });

  it('walks nested subdirectories and ignores non-markdown files', () => {
    write('policy/clients/acme.md', VALID_POLICY.replace('pol.test-policy', 'pol.acme'));
    write('README.txt', 'not law');
    write('notes.json', '{}');

    const result = loadLawDirectory(dir);

    expect(result.errors).toEqual([]);
    expect(result.documents.map((d) => d.id)).toEqual(['pol.acme']);
  });

  it('rejects a document whose frontmatter is not valid YAML, without throwing', () => {
    write('policy/broken.md', '---\nid: [unclosed\nkind policy\n---\nbody\n');

    const result = loadLawDirectory(dir);

    expect(result.documents).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('policy/broken.md');
    expect(result.errors[0].reason).toMatch(/yaml/i);
  });

  it('rejects a document with no frontmatter block', () => {
    write('policy/prose-only.md', '# Just prose\n\nNo frontmatter at all.\n');

    const result = loadLawDirectory(dir);

    expect(result.documents).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/frontmatter/i);
  });

  it('rejects a document missing required identity fields', () => {
    write('policy/no-id.md', '---\nkind: policy\nversion: 1.0.0\nconstraints: []\n---\nbody\n');

    const result = loadLawDirectory(dir);

    expect(result.documents).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/id/);
  });

  it('rejects a constraint with an unknown enforcement class', () => {
    write(
      'policy/bad-enforcement.md',
      VALID_POLICY.replace('enforcement: gateway', 'enforcement: hopeful')
    );

    const result = loadLawDirectory(dir);

    expect(result.documents).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/enforcement/);
  });

  it('rejects a later document that reuses an already-loaded constraint id', () => {
    write('policy/a-first.md', VALID_POLICY.replace('pol.test-policy', 'pol.first'));
    write('policy/b-second.md', VALID_POLICY.replace('pol.test-policy', 'pol.second'));

    const result = loadLawDirectory(dir);

    expect(result.documents.map((d) => d.id)).toEqual(['pol.first']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('policy/b-second.md');
    expect(result.errors[0].reason).toMatch(/c\.test-gateway/);
  });

  it('accepts a runbook document with minimal frontmatter and no constraints (ADR-17)', () => {
    write(
      'runbooks/diagnose.md',
      '---\nid: rb.diagnose\nkind: runbook\nversion: 0.1.0\n---\n\n# Diagnose\n\nSteps.\n'
    );

    const result = loadLawDirectory(dir);

    expect(result.errors).toEqual([]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].kind).toBe('runbook');
    expect(result.documents[0].constraints).toEqual([]);
  });

  it('returns an error for a missing directory rather than throwing', () => {
    const result = loadLawDirectory(path.join(dir, 'does-not-exist'));

    expect(result.documents).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/directory/i);
  });

  it('one bad document does not prevent its siblings from loading', () => {
    write('policy/good.md', VALID_POLICY);
    write('policy/bad.md', '---\nid: [unclosed\n---\nbody\n');

    const result = loadLawDirectory(dir);

    expect(result.documents.map((d) => d.id)).toEqual(['pol.test-policy']);
    expect(result.errors).toHaveLength(1);
  });
});
