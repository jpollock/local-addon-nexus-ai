import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rotateIfNeeded, pruneOldFiles } from '../../../src/main/logging/rotate';

describe('rotateIfNeeded', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rotate-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('does nothing when the file does not exist', () => {
    const f = path.join(dir, 'missing.log');
    expect(() => rotateIfNeeded(f, 100, 3)).not.toThrow();
    expect(fs.existsSync(f)).toBe(false);
  });

  it('does nothing when the file is under the size limit', () => {
    const f = path.join(dir, 'small.log');
    fs.writeFileSync(f, 'x'.repeat(50));
    rotateIfNeeded(f, 100, 3);
    expect(fs.existsSync(f)).toBe(true);
    expect(fs.existsSync(`${f}.1`)).toBe(false);
  });

  it('rotates the file to .1 once it reaches the limit', () => {
    const f = path.join(dir, 'big.log');
    fs.writeFileSync(f, 'x'.repeat(100));
    rotateIfNeeded(f, 100, 3);
    expect(fs.existsSync(f)).toBe(false);          // caller re-creates on next append
    expect(fs.readFileSync(`${f}.1`, 'utf-8')).toBe('x'.repeat(100));
  });

  it('shifts generations and drops the oldest beyond keep', () => {
    const f = path.join(dir, 'gen.log');
    fs.writeFileSync(`${f}.3`, 'oldest');
    fs.writeFileSync(`${f}.2`, 'older');
    fs.writeFileSync(`${f}.1`, 'old');
    fs.writeFileSync(f, 'x'.repeat(100));

    rotateIfNeeded(f, 100, 3);

    expect(fs.readFileSync(`${f}.1`, 'utf-8')).toBe('x'.repeat(100));
    expect(fs.readFileSync(`${f}.2`, 'utf-8')).toBe('old');
    expect(fs.readFileSync(`${f}.3`, 'utf-8')).toBe('older');
    expect(fs.existsSync(`${f}.4`)).toBe(false);   // 'oldest' dropped
  });

  it('never throws on an unwritable path', () => {
    // Not a /proc path. rotateIfNeeded happens to stat() first and returns
    // early, so '/proc/...' did not hang here the way it did in
    // eventLog.test.ts and OperationAuditLog.test.ts — but it is the same
    // fragile assumption (that /proc is absent, which is true only on macOS)
    // and it would hang the moment this function grew an mkdir.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rot-unwritable-'));
    const blocker = path.join(base, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    expect(() => rotateIfNeeded(path.join(blocker, 'writable.log'), 1, 3)).not.toThrow();
  });
});

describe('pruneOldFiles', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prune-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps the newest N matching files and deletes the rest', () => {
    for (let i = 1; i <= 5; i++) {
      const f = path.join(dir, `run-${i}.log`);
      fs.writeFileSync(f, 'data');
      fs.utimesSync(f, new Date(i * 100000), new Date(i * 100000)); // 5 is newest
    }
    const deleted = pruneOldFiles(dir, /^run-.*\.log$/, 2);
    expect(deleted).toBe(3);
    expect(fs.existsSync(path.join(dir, 'run-5.log'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-4.log'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-1.log'))).toBe(false);
  });

  it('ignores files that do not match the pattern', () => {
    fs.writeFileSync(path.join(dir, 'run-1.log'), 'x');
    fs.writeFileSync(path.join(dir, 'agent.log'), 'keep me');
    pruneOldFiles(dir, /^run-.*\.log$/, 0);
    expect(fs.existsSync(path.join(dir, 'agent.log'))).toBe(true);
  });

  it('returns 0 and does not throw for a missing directory', () => {
    expect(pruneOldFiles(path.join(dir, 'nope'), /.*/, 1)).toBe(0);
  });
});
