import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptWriter } from '../../../src/main/logging/transcript';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-transcript-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('TranscriptWriter', () => {
  it('writes one JSON object per line under transcripts/', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    w.append({ turn: 1, role: 'prompt', model: 'claude-opus-5', content: 'scan acfprod' });
    w.append({ turn: 1, role: 'response', model: 'claude-opus-5', content: 'I will start by…' });

    const file = path.join(root, 'transcripts', 'r_abc.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ turn: 1, role: 'prompt', content: 'scan acfprod' });
    expect(JSON.parse(lines[1]).role).toBe('response');
  });

  it('is 0600 — a transcript is the most sensitive thing this system writes', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' });
    const mode = fs.statSync(path.join(root, 'transcripts', 'r_abc.jsonl')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keeps a newline out of the record so one entry stays one line', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'line one\nline two' });
    const raw = fs.readFileSync(path.join(root, 'transcripts', 'r_abc.jsonl'), 'utf-8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw).content).toBe('line one\nline two');
  });

  it('never throws when the directory cannot be written', () => {
    const w = new TranscriptWriter({ root: '/proc/nonexistent-nexus', runId: 'r_abc' });
    expect(() => w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' })).not.toThrow();
  });

  it('reports its own path so a log line can point at it', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    expect(w.path().endsWith(path.join('transcripts', 'r_abc.jsonl'))).toBe(true);
  });

  it('restores 0600 on a file that already exists with looser permissions', () => {
    // appendFileSync's `mode` applies only when it CREATES the file. Without the chmod that
    // follows the write, a transcript file left at 0644 by anything else stays 0644 forever —
    // and this is the most sensitive artefact the logging system writes.
    const w = new TranscriptWriter({ root, runId: 'r_existing' });
    const file = path.join(root, 'transcripts', 'r_existing.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '', { mode: 0o644 });
    fs.chmodSync(file, 0o644);                       // defeat any umask interference

    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('restores 0700 on a transcripts/ directory that already exists with looser permissions', () => {
    // mkdirSync's `mode` applies only when it CREATES the directory — the identical caveat that
    // justifies reapplying the file's 0600 above. A pre-existing transcripts/ directory at 0755
    // must not stay 0755 forever.
    const dir = path.join(root, 'transcripts');
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.chmodSync(dir, 0o755);                          // defeat any umask interference

    const w = new TranscriptWriter({ root, runId: 'r_dir_existing' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' });

    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('sanitizes a runId containing path traversal so it cannot escape the transcripts directory', () => {
    const w = new TranscriptWriter({ root, runId: '../../etc/evil' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' });

    const transcriptsDir = path.join(root, 'transcripts');
    // The written file must land INSIDE transcripts/, not escape it via the traversal segments.
    expect(path.dirname(w.path())).toBe(transcriptsDir);
    expect(fs.existsSync(w.path())).toBe(true);
    expect(JSON.parse(fs.readFileSync(w.path(), 'utf-8').trim()).content).toBe('x');
  });

  // FIX 1: Redaction tests
  it('masks credential-shaped content (sk- vendor key and DB_PASSWORD)', () => {
    const w = new TranscriptWriter({ root, runId: 'r_redact' });
    w.append({
      turn: 1, role: 'prompt', model: 'claude-opus-5',
      content: 'Check wp-config.php: sk-ant-api03-abcd1234 and define("DB_PASSWORD", "MySecret123")',
    });

    const file = path.join(root, 'transcripts', 'r_redact.jsonl');
    const line = fs.readFileSync(file, 'utf-8').trim();
    const entry = JSON.parse(line);

    expect(entry.content).not.toContain('sk-ant-api03-abcd1234');
    expect(entry.content).not.toContain('MySecret123');
    expect(entry.content).toContain('[REDACTED]');
    expect(entry.content).toContain('Check wp-config.php'); // surrounding prose survives
  });

  it('masks credential-shaped model names', () => {
    const w = new TranscriptWriter({ root, runId: 'r_model' });
    w.append({ turn: 1, role: 'prompt', model: 'sk-sneaky-model-name', content: 'test' });

    const file = path.join(root, 'transcripts', 'r_model.jsonl');
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8').trim());

    expect(entry.model).not.toContain('sk-sneaky');
    expect(entry.model).toBe('[REDACTED]');
  });

  it('leaves non-credential content unmasked', () => {
    const w = new TranscriptWriter({ root, runId: 'r_clean' });
    w.append({ turn: 1, role: 'prompt', model: 'claude-opus-5', content: 'Scan acfprod for outdated plugins' });

    const file = path.join(root, 'transcripts', 'r_clean.jsonl');
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8').trim());

    expect(entry.content).toBe('Scan acfprod for outdated plugins');
    expect(entry.model).toBe('claude-opus-5');
  });

  // FIX 2: Sequencing and pairing tests
  it('assigns monotonically increasing seq to each entry', () => {
    const w = new TranscriptWriter({ root, runId: 'r_seq' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'first' });
    w.append({ turn: 1, role: 'response', model: 'm', content: 'second' });
    w.append({ turn: 2, role: 'prompt', model: 'm', content: 'third' });

    const file = path.join(root, 'transcripts', 'r_seq.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    const entries = lines.map(l => JSON.parse(l));

    expect(entries[0].seq).toBe(1);
    expect(entries[1].seq).toBe(2);
    expect(entries[2].seq).toBe(3);
  });

  it('adds ISO timestamp to each entry', () => {
    const w = new TranscriptWriter({ root, runId: 'r_time' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' });

    const file = path.join(root, 'transcripts', 'r_time.jsonl');
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8').trim());

    expect(entry.at).toBeDefined();
    expect(new Date(entry.at).toISOString()).toBe(entry.at); // valid ISO string
  });

  it('preserves callId to pair prompt and response even when interleaved', () => {
    const w = new TranscriptWriter({ root, runId: 'r_pair' });
    const call1 = 'call-1-uuid';
    const call2 = 'call-2-uuid';

    // Simulate Promise.all: two prompts, then two responses in reverse order
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'p1', callId: call1 });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'p2', callId: call2 });
    w.append({ turn: 1, role: 'response', model: 'm', content: 'r2', callId: call2 }); // call2 finishes first
    w.append({ turn: 1, role: 'response', model: 'm', content: 'r1', callId: call1 });

    const file = path.join(root, 'transcripts', 'r_pair.jsonl');
    const entries = fs.readFileSync(file, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

    const call1Entries = entries.filter(e => e.callId === call1);
    const call2Entries = entries.filter(e => e.callId === call2);

    expect(call1Entries).toHaveLength(2);
    expect(call1Entries[0].content).toBe('p1');
    expect(call1Entries[1].content).toBe('r1');

    expect(call2Entries).toHaveLength(2);
    expect(call2Entries[0].content).toBe('p2');
    expect(call2Entries[1].content).toBe('r2');
  });

  // FIX 3: Budget and truncation tests
  it('stops appending past the budget and writes one truncation marker', () => {
    const smallBudget = 500;
    const w = new TranscriptWriter({ root, runId: 'r_budget', maxBytes: smallBudget });

    // Write entries until we exceed the budget
    const largeContent = 'x'.repeat(200);
    for (let i = 0; i < 10; i++) {
      w.append({ turn: i + 1, role: 'prompt', model: 'm', content: largeContent });
    }

    const file = path.join(root, 'transcripts', 'r_budget.jsonl');
    const raw = fs.readFileSync(file, 'utf-8');
    const lines = raw.trim().split('\n');
    const entries = lines.map(l => JSON.parse(l));

    // Should have stopped before 10 entries
    expect(entries.length).toBeLessThan(10);

    // Last entry should be the truncation marker
    const last = entries[entries.length - 1];
    expect(last.role).toBe('truncated');
    expect(last.content).toContain('Transcript truncated');

    // File should be under the budget
    expect(Buffer.byteLength(raw, 'utf-8')).toBeLessThan(smallBudget + 200); // +200 for the marker itself
  });

  it('does not write a truncation marker when under budget', () => {
    const w = new TranscriptWriter({ root, runId: 'r_no_truncate' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'small' });

    const file = path.join(root, 'transcripts', 'r_no_truncate.jsonl');
    const entries = fs.readFileSync(file, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

    expect(entries.every(e => e.role !== 'truncated')).toBe(true);
  });

  it('counts every dropped entry, not just the one that tripped the budget', () => {
    // This test previously asserted the marker said "1 entries dropped", with a comment noting
    // the count was 1 at marker-write time. That pinned a defect: the marker is written the
    // instant the budget is hit, so its figure is always 1 however many entries follow — it read
    // "1 entries dropped" for a run that dropped 38. The count now lives on droppedCount(), which
    // can be read after the run when the real number is known.
    const smallBudget = 300;
    const w = new TranscriptWriter({ root, runId: 'r_count_after', maxBytes: smallBudget });

    const content = 'x'.repeat(100);
    for (let i = 0; i < 10; i++) {
      w.append({ turn: i + 1, role: 'prompt', model: 'm', content });
    }

    const file = path.join(root, 'transcripts', 'r_count_after.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    const marker = JSON.parse(lines[lines.length - 1]);

    expect(marker.role).toBe('truncated');
    expect(marker.content).not.toMatch(/\d+ entries dropped/);
    expect(w.droppedCount()).toBeGreaterThan(1);
  });

  it('never throws when redaction or sequencing logic fails', () => {
    const w = new TranscriptWriter({ root, runId: 'r_robust' });
    // Pathological input should not crash
    expect(() => {
      w.append({ turn: 1, role: 'prompt', model: 'm', content: ' ￿' });
    }).not.toThrow();
  });
});

describe('the truncation marker states only what it can know', () => {
  it('does not print a drop count that is wrong by the time the run ends', () => {
    // The marker is written the instant the budget is hit, when exactly one entry has been
    // dropped — but the run keeps going. Interpolating the then-current figure printed
    // "1 entries dropped" for a run that went on to drop 38. A wrong number that looks
    // authoritative is worse than no number, so the file states the fact and droppedCount()
    // carries the tally.
    const w = new TranscriptWriter({ root, runId: 'r_count', maxBytes: 400 });
    for (let i = 0; i < 40; i++) {
      w.append({ turn: i, role: 'prompt', model: 'm', content: 'x'.repeat(200) });
    }
    const entries = fs.readFileSync(path.join(root, 'transcripts', 'r_count.jsonl'), 'utf-8')
      .trim().split('\n').map(l => JSON.parse(l));
    const marker = entries.find(e => e.role === 'truncated');

    expect(marker).toBeDefined();
    expect(marker.content).not.toMatch(/\d+ entries dropped/);
    expect(w.droppedCount()).toBeGreaterThan(30);
  });

  it('writes the marker exactly once however many entries follow', () => {
    const w = new TranscriptWriter({ root, runId: 'r_once', maxBytes: 400 });
    for (let i = 0; i < 40; i++) {
      w.append({ turn: i, role: 'prompt', model: 'm', content: 'x'.repeat(200) });
    }
    const entries = fs.readFileSync(path.join(root, 'transcripts', 'r_once.jsonl'), 'utf-8')
      .trim().split('\n').map(l => JSON.parse(l));
    expect(entries.filter(e => e.role === 'truncated')).toHaveLength(1);
  });
});
