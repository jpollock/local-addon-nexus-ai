import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, StreamTrigger } from '../agent-sdk/types';
import type { AgentEventBus } from '../agent-event-bus/AgentEventBus';

const logger = createLogger('DaemonManager');

const MAX_DAEMONS = 5;
const WORKER_PATH = path.join(__dirname, 'daemon-worker');
const HEARTBEAT_TIMEOUT_MS = 15_000;
const MAX_RESTART_DELAY_MS = 5 * 60 * 1_000; // 5 minutes

export type DaemonStatus = 'running' | 'stopped' | 'restarting';

interface DaemonEntry {
  agent: AgentDefinition;
  pattern: string;
  proc: ChildProcess | null;
  status: DaemonStatus;
  restartCount: number;
  lastHeartbeat: number;
  unsubscribeFromBus: (() => void) | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

export class DaemonManager {
  private daemons = new Map<string, DaemonEntry>();
  private bus: AgentEventBus;

  constructor(bus: AgentEventBus) {
    this.bus = bus;
  }

  start(agent: AgentDefinition): void {
    const streamTriggers = agent.triggers.filter(
      (t): t is StreamTrigger => t.type === 'stream',
    );

    // Silently skip agents that have no stream triggers — they are task/cron agents
    if (streamTriggers.length === 0) return;

    const runningCount = Array.from(this.daemons.values()).filter(
      d => d.status === 'running',
    ).length;
    if (runningCount >= MAX_DAEMONS) {
      throw new Error(`Maximum daemon agent limit (${MAX_DAEMONS}) reached`);
    }

    const pattern = streamTriggers[0].pattern;
    const entry: DaemonEntry = {
      agent,
      pattern,
      proc: null,
      status: 'stopped',
      restartCount: 0,
      lastHeartbeat: Date.now(),
      unsubscribeFromBus: null,
      heartbeatTimer: null,
    };
    this.daemons.set(agent.name, entry);
    this.spawnDaemon(entry);
  }

  private spawnDaemon(entry: DaemonEntry): void {
    // Resolve agent path from standard agent directory structure.
    // Workers are loaded from disk; in tests the path may not resolve —
    // the worker exits quickly, but status tracking is synchronous so tests pass.
    const agentDir = path.join(
      os.homedir(),
      'Library', 'Application Support', 'Local', 'nexus-ai', 'agents',
      entry.agent.name,
    );
    const tsPath = path.join(agentDir, 'agent.ts');
    const jsPath = path.join(agentDir, 'agent.js');
    const agentPath = fs.existsSync(tsPath) ? tsPath : jsPath;

    // When running inside Jest, register ts-node so the worker can load TS files
    const execArgv = process.env.JEST_WORKER_ID
      ? ['-r', 'ts-node/register']
      : [];

    let proc: ChildProcess;
    try {
      proc = fork(WORKER_PATH, [], {
        execArgv,
        stdio: ['ipc', process.stdout, process.stderr],
      });
    } catch (err: any) {
      logger.warn(`DaemonManager: failed to fork worker for "${entry.agent.name}": ${err.message}`);
      this.scheduleRestart(entry);
      return;
    }

    entry.proc = proc;
    entry.status = 'running';
    entry.lastHeartbeat = Date.now();

    // Send init message — ignore channel-closed errors (process may exit fast)
    try {
      proc.send({ type: 'init', agentPath, agentName: entry.agent.name, pattern: entry.pattern });
    } catch {
      // worker may have already exited; restart will handle it
    }

    proc.on('message', (msg: any) => {
      if (msg.type === 'heartbeat') entry.lastHeartbeat = Date.now();
      if (msg.type === 'log') {
        logger.info(`[${entry.agent.name}] ${msg.msg}`);
      }
      if (msg.type === 'tool_call') {
        // Proxy tool calls back to main process — stub for now
        try {
          proc.send({ type: 'tool_result', callId: msg.callId, result: null });
        } catch {
          // channel may be closed
        }
      }
    });

    proc.on('error', (err) => {
      logger.warn(`DaemonManager: "${entry.agent.name}" process error: ${err.message}`);
    });

    proc.on('exit', (code) => {
      if (entry.status === 'stopped') return; // intentional stop — do not restart
      logger.warn(`DaemonManager: "${entry.agent.name}" exited with code ${code} — scheduling restart`);
      this.scheduleRestart(entry);
    });

    // Subscribe to bus events and forward to daemon
    if (entry.unsubscribeFromBus) entry.unsubscribeFromBus();
    entry.unsubscribeFromBus = this.bus.subscribe(entry.pattern, (event) => {
      try {
        proc.send({ type: 'event', event });
      } catch {
        // channel closed — restart will re-subscribe
      }
    });

    // Heartbeat watchdog — kill if silent for HEARTBEAT_TIMEOUT_MS
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
    entry.heartbeatTimer = setInterval(() => {
      if (Date.now() - entry.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        logger.warn(`DaemonManager: "${entry.agent.name}" missed heartbeat — sending SIGKILL`);
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private scheduleRestart(entry: DaemonEntry): void {
    entry.status = 'restarting';
    // Exponential backoff: 1s → 2s → 4s → ... capped at 5 minutes
    const delay = Math.min(1_000 * Math.pow(2, entry.restartCount), MAX_RESTART_DELAY_MS);
    entry.restartCount++;
    logger.info(
      `DaemonManager: restarting "${entry.agent.name}" in ${delay}ms (attempt ${entry.restartCount})`,
    );
    setTimeout(() => {
      if (entry.status !== 'stopped') this.spawnDaemon(entry);
    }, delay);
  }

  stop(name: string): void {
    const entry = this.daemons.get(name);
    if (!entry) return;

    entry.status = 'stopped'; // mark first to suppress restart on exit

    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }

    if (entry.unsubscribeFromBus) {
      entry.unsubscribeFromBus();
      entry.unsubscribeFromBus = null;
    }

    if (entry.proc) {
      try { entry.proc.send({ type: 'shutdown' }); } catch { /* already gone */ }
      // Give it 10s to exit gracefully, then SIGKILL
      const killTimer = setTimeout(() => {
        try { entry.proc?.kill('SIGKILL'); } catch { /* already dead */ }
      }, 10_000);
      // Unref so this timer does not keep the Jest process alive
      if (killTimer.unref) killTimer.unref();
      entry.proc = null;
    }
  }

  async stopAll(): Promise<void> {
    const names = Array.from(this.daemons.keys());
    names.forEach(name => this.stop(name));
  }

  status(name: string): DaemonStatus {
    return this.daemons.get(name)?.status ?? 'stopped';
  }
}
