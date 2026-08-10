import * as fs from 'fs';
import * as path from 'path';

export interface TranscriptEntry {
  turn: number;
  role: 'prompt' | 'response';
  model: string;
  content: string;
}

export interface TranscriptOptions {
  /** The log root — transcripts live in a `transcripts/` directory beneath it. */
  root: string;
  runId: string;
}

/**
 * Every caller today passes a `newRunId()` value, which is already `[a-z0-9_]` only — but this
 * class writes the most sensitive file in the system and has no defence of its own if that
 * invariant ever changes elsewhere. Strip anything outside the safe set before it becomes a path
 * segment, the same allowlist reasoning `eventLog.ts`'s `sanitizeSourceName` applies to `source`.
 */
function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * The full prompt and response of each model turn, for the one agent you are debugging.
 *
 * Off by default and enabled per agent, because this is the most sensitive thing the logging
 * system writes: a prompt carries site content, findings, and whatever the agent put in it.
 * 0600, one JSON object per line, named by run id so a `llm.call` line can point at it.
 */
export class TranscriptWriter {
  private readonly file: string;

  constructor(opts: TranscriptOptions) {
    this.file = path.join(opts.root, 'transcripts', `${sanitizeRunId(opts.runId)}.jsonl`);
  }

  path(): string { return this.file; }

  /** Never throws — a transcript is a debugging aid, not a reason to fail a run. */
  append(entry: TranscriptEntry): void {
    try {
      const dir = path.dirname(this.file);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      // mkdirSync's `mode` applies only when it CREATES the directory — same Node caveat as
      // appendFileSync's `mode` below, so a pre-existing transcripts/ directory needs the same
      // reapply-after-the-fact treatment.
      try { fs.chmodSync(dir, 0o700); } catch { /* best effort on a pre-existing directory */ }
      // JSON.stringify escapes the newlines inside content, so one entry stays one line.
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      try { fs.chmodSync(this.file, 0o600); } catch { /* best effort on a pre-existing file */ }
    } catch { /* a transcript that cannot be written must not fail the run */ }
  }
}
