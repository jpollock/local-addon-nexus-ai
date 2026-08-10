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
});
