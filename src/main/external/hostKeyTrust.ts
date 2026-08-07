/**
 * Capture the SSH host key an alias offers, and — once a human has approved
 * it via Local's Settings UI — trust it. See
 * docs/superpowers/specs/2026-08-07-host-key-trust-on-first-use-design.md.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildHostKeyCaptureArgs, HOST_KEY_CAPTURE_TIMEOUT_MS, assertSafeSshAlias } from '../transport/ssh-args';
import type { SshExec } from './sshExec';

export interface CapturedHostKey {
  fingerprint: string;
  keyType: string;
  rawLine: string;
}

export type KeygenExec = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const defaultKeygenExec: KeygenExec = (args) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh-keygen', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) => resolve({ code: null, stdout: '', stderr: err.message }));
  });

/** `<bits> SHA256:<fingerprint> <host> (<TYPE>)` — ssh-keygen -lf's own format. */
const KEYGEN_FINGERPRINT_RE = /^\d+\s+(SHA256:\S+)\s+\S+\s+\(([A-Za-z0-9-]+)\)/;

/**
 * Fetch the host key an alias currently offers, without trusting it.
 *
 * Connects through the alias into an isolated temp known_hosts file (see
 * buildHostKeyCaptureArgs) so the offered key can be inspected before any
 * trust decision, then computes its fingerprint with `ssh-keygen -lf`.
 *
 * Returns null for ANY failure — unreachable host, no key received, or
 * unparseable ssh-keygen output. Callers must treat null as "could not
 * determine", never as "trusted" or "known to have changed".
 */
export async function captureOfferedHostKey(
  alias: string,
  exec: SshExec,
  keygenExec: KeygenExec = defaultKeygenExec,
): Promise<CapturedHostKey | null> {
  assertSafeSshAlias(alias);
  const tempFile = path.join(os.tmpdir(), `nexus-hostkey-${crypto.randomUUID()}`);
  try {
    await exec(buildHostKeyCaptureArgs(alias, tempFile), HOST_KEY_CAPTURE_TIMEOUT_MS);

    let rawLine: string;
    try {
      rawLine = fs.readFileSync(tempFile, 'utf-8').trim().split('\n')[0]?.trim() ?? '';
    } catch {
      return null;
    }
    if (!rawLine) return null;

    const fp = await keygenExec(['-lf', tempFile]);
    const m = KEYGEN_FINGERPRINT_RE.exec(fp.stdout.trim());
    if (!m) return null;

    return { fingerprint: m[1], keyType: m[2], rawLine };
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* never created, or already gone */ }
  }
}

/**
 * Append a raw known_hosts line to the real file, creating the parent
 * directory if needed. The ONLY function in this module that touches real
 * trust state — called exclusively from the TRUST_EXTERNAL_HOST_KEY IPC
 * handler (renderer-only; see ipc-handlers.ts).
 */
export function trustHostKey(userKnownHostsFile: string, rawLine: string): void {
  fs.mkdirSync(path.dirname(userKnownHostsFile), { recursive: true, mode: 0o700 });
  fs.appendFileSync(userKnownHostsFile, `${rawLine.trim()}\n`);
}
