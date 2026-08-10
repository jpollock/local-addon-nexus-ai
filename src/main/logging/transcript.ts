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
 * The full prompt and response of each model turn, for the one agent you are debugging.
 *
 * Off by default and enabled per agent, because this is the most sensitive thing the logging
 * system writes: a prompt carries site content, findings, and whatever the agent put in it.
 * 0600, one JSON object per line, named by run id so a `llm.call` line can point at it.
 */
export class TranscriptWriter {
  private readonly file: string;

  constructor(opts: TranscriptOptions) {
    this.file = path.join(opts.root, 'transcripts', `${opts.runId}.jsonl`);
  }

  path(): string { return this.file; }

  /** Never throws — a transcript is a debugging aid, not a reason to fail a run. */
  append(entry: TranscriptEntry): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      // JSON.stringify escapes the newlines inside content, so one entry stays one line.
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      try { fs.chmodSync(this.file, 0o600); } catch { /* best effort on a pre-existing file */ }
    } catch { /* a transcript that cannot be written must not fail the run */ }
  }
}
