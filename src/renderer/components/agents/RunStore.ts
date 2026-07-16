import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type SiteRunStatus = 'running' | 'done' | 'findings' | 'failed';

export interface LogLine {
  ts: string;       // 'mm:ss'
  site: string;
  msg: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

export interface Run {
  runId: string;
  agentId: string;
  agentName: string;
  siteNames: string[];
  phase: 'running' | 'done';
  cancelled?: boolean;
  startedAt: number;
  endedAt?: number;
  doneCount: number;
  failedCount: number;
  findingsSites: string[];
  siteStatus: Record<string, SiteRunStatus>;
  log: LogLine[];
}

interface RunState {
  currentRun: Run | null;
  drawerOpen: boolean;
}

function parseLogLine(rawLine: string, startedAt: number): { site: string; msg: string; level: LogLine['level'] } | null {
  // Format: [INFO/WARN/ERROR] 2026-07-15T... [message]
  // Extract meaningful content
  const timeMatch = rawLine.match(/^\[(\w+)\]\s+[\d\-T:.Z]+\s+(.+)$/);
  if (!timeMatch) return null;
  const [, levelRaw, content] = timeMatch;
  const level: LogLine['level'] = levelRaw === 'WARN' ? 'warn' : levelRaw === 'ERROR' ? 'error' : 'info';

  // Parse site from content — two formats:
  //   "security-sentinel: theawfulpmtest — ..."  (original)
  //   "[site] theawfulpmtest — ↑ escalated"      (structured AgentRunner format)
  const siteMatch = content.match(/^security-sentinel:\s+([\w-]+)\s+[—–]/)
    ?? content.match(/^\[site\]\s+([\w-]+)\s+[—–]/);
  const site = siteMatch ? siteMatch[1] : '';

  // Determine ok vs info
  const effectiveLevel: LogLine['level'] = content.includes('✓ clean') ? 'ok'
    : content.includes('finding(s)') || content.includes('ESCALATING') ? 'warn'
    : level;

  return { site, msg: content, level: effectiveLevel };
}

function elapsedSeconds(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

class RunStore {
  private state: RunState = { currentRun: null, drawerOpen: false };
  private listeners = new Set<() => void>();
  private watcher: fs.FSWatcher | null = null;
  private watchPoll: ReturnType<typeof setInterval> | null = null;
  private logOffset = 0;

  getState(): RunState { return this.state; }

  setState(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  subscribe(fn: () => void): void   { this.listeners.add(fn); }
  unsubscribe(fn: () => void): void { this.listeners.delete(fn); }

  startRun(params: { runId: string; agentId: string; agentName: string; siteNames: string[] }): void {
    this.logOffset = 0;
    const run: Run = {
      ...params,
      phase: 'running',
      startedAt: Date.now(),
      doneCount: 0,
      failedCount: 0,
      findingsSites: [],
      siteStatus: {},
      log: [],
    };
    this.setState({ currentRun: run });
    this.startWatching(params.agentId, run.startedAt);
  }

  completeRun(payload: { runId: string; doneCount: number; failedCount: number; findingsSites: string[]; cancelled?: boolean }): void {
    const run = this.state.currentRun;
    if (!run || run.runId !== payload.runId) return;
    this.flushLog(run.agentId);
    this.stopWatching();
    // Re-read currentRun after flush — flushLog may have updated log lines via setState
    const flushed = this.state.currentRun ?? run;
    this.setState({
      currentRun: {
        ...flushed,
        phase: 'done',
        cancelled: payload.cancelled ?? false,
        endedAt: Date.now(),
        doneCount: payload.doneCount,
        failedCount: payload.failedCount,
        findingsSites: payload.findingsSites,
      },
    });
  }

  dismissRun(): void {
    this.stopWatching();
    this.setState({ currentRun: null, drawerOpen: false });
    this.logOffset = 0;
  }

  toggleDrawer(): void {
    this.setState({ drawerOpen: !this.state.drawerOpen });
  }

  getElapsed(): string {
    const run = this.state.currentRun;
    if (!run) return '0:00';
    const end = run.endedAt ?? Date.now();
    const secs = Math.floor((end - run.startedAt) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private startWatching(agentId: string, startedAt: number): void {
    const logPath = path.join(
      os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
      'agents', agentId, 'logs', 'agent.log',
    );
    // Record current file size so we only read new content
    try { this.logOffset = fs.statSync(logPath).size; } catch { this.logOffset = 0; }

    const processNewLines = () => {
      const run = this.state.currentRun;
      if (!run) return;
      try {
        const stat = fs.statSync(logPath);
        // Log was rotated (new file smaller than our offset) — restart from beginning
        if (stat.size < this.logOffset) this.logOffset = 0;
        if (stat.size <= this.logOffset) return;
        const buf = Buffer.alloc(stat.size - this.logOffset);
        const fd = fs.openSync(logPath, 'r');
        fs.readSync(fd, buf, 0, buf.length, this.logOffset);
        fs.closeSync(fd);
        this.logOffset = stat.size;

        const newLines = buf.toString('utf-8').split('\n').filter(Boolean);
        const newLog: LogLine[] = [];
        const siteUpdates: Record<string, SiteRunStatus> = {};

        for (const raw of newLines) {
          const parsed = parseLogLine(raw, startedAt);
          if (!parsed) continue;

          const secs = elapsedSeconds(startedAt);
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          newLog.push({
            ts: `${m}:${s.toString().padStart(2, '0')}`,
            site: parsed.site,
            msg: parsed.msg,
            level: parsed.level,
          });

          // Derive per-site status from log content
          if (parsed.site) {
            if (parsed.msg.includes('✓ clean')) {
              siteUpdates[parsed.site] = 'done';
            } else if (parsed.msg.includes('ESCALATING') || parsed.msg.includes('Tier 2') || parsed.msg.includes('↑ escalated')) {
              siteUpdates[parsed.site] = 'running';
            } else if (parsed.msg.includes('finding(s)') || parsed.msg.includes('CRITICAL') || parsed.msg.includes('Active threat') || parsed.msg.includes('→ findings')) {
              siteUpdates[parsed.site] = 'findings';
            }
          }
        }

        if (newLog.length > 0 || Object.keys(siteUpdates).length > 0) {
          this.setState({
            currentRun: {
              ...run,
              log: [...run.log, ...newLog].slice(-500), // keep last 500 lines
              siteStatus: { ...run.siteStatus, ...siteUpdates },
            },
          });
        }
      } catch { /* file not ready yet */ }
    };

    try {
      this.watcher = fs.watch(logPath, { persistent: false }, () => processNewLines());
    } catch {
      // File may not exist yet — poll until it appears, then switch to fs.watch
      this.watchPoll = setInterval(() => {
        if (!this.state.currentRun) { clearInterval(this.watchPoll!); this.watchPoll = null; return; }
        processNewLines();
        if (!this.watcher) {
          try {
            this.watcher = fs.watch(logPath, { persistent: false }, () => processNewLines());
            clearInterval(this.watchPoll!);
            this.watchPoll = null;
          } catch { /* keep polling */ }
        }
      }, 2000);
    }
  }

  private flushLog(agentId: string): void {
    const logPath = path.join(
      os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
      'agents', agentId, 'logs', 'agent.log',
    );
    const run = this.state.currentRun;
    if (!run) return;
    try {
      const stat = fs.statSync(logPath);
      if (stat.size < this.logOffset) this.logOffset = 0;
      if (stat.size <= this.logOffset) return;
      const buf = Buffer.alloc(stat.size - this.logOffset);
      const fd = fs.openSync(logPath, 'r');
      fs.readSync(fd, buf, 0, buf.length, this.logOffset);
      fs.closeSync(fd);
      this.logOffset = stat.size;
      const newLines = buf.toString('utf-8').split('\n').filter(Boolean);
      const newLog: LogLine[] = [];
      for (const raw of newLines) {
        const parsed = parseLogLine(raw, run.startedAt);
        if (!parsed) continue;
        const secs = Math.floor((Date.now() - run.startedAt) / 1000);
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        newLog.push({ ts: `${m}:${s.toString().padStart(2, '0')}`, site: parsed.site, msg: parsed.msg, level: parsed.level });
      }
      if (newLog.length > 0) {
        this.setState({ currentRun: { ...run, log: [...run.log, ...newLog].slice(-500) } });
      }
    } catch {}
  }

  private stopWatching(): void {
    if (this.watchPoll) { clearInterval(this.watchPoll); this.watchPoll = null; }
    if (this.watcher) {
      try { this.watcher.close(); } catch {}
      this.watcher = null;
    }
  }
}

export const runStore = new RunStore();
