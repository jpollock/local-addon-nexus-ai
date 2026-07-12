// This file runs as a forked child process for daemon agents.
// It receives events from the parent via IPC and calls agent.run().

import * as path from 'path';

interface DaemonInit {
  type: 'init';
  agentPath: string;
  agentName: string;
  pattern: string;
}

interface DaemonEvent {
  type: 'event';
  event: any;
}

interface DaemonShutdown {
  type: 'shutdown';
}

type ParentMessage = DaemonInit | DaemonEvent | DaemonShutdown;

let agentRun: ((ctx: any) => Promise<void>) | undefined;
let agentName: string | undefined;

const noopProvider = {
  invoke: async (name: string, args: any) => {
    return new Promise<unknown>((resolve, reject) => {
      const callId = Math.random().toString(36).slice(2);
      process.send!({ type: 'tool_call', callId, name, args });
      const handler = (msg: any) => {
        if (msg?.type === 'tool_result' && msg.callId === callId) {
          process.off('message', handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      };
      process.on('message', handler);
    });
  },
};

const noopState = { get: () => undefined, set: () => {}, delete: () => {}, scratch: {} };
const noopAi = { complete: async () => '' };
const noopLog = {
  info:  (msg: string) => process.send!({ type: 'log', level: 'info',  msg }),
  warn:  (msg: string) => process.send!({ type: 'log', level: 'warn',  msg }),
  error: (msg: string) => process.send!({ type: 'log', level: 'error', msg }),
  debug: (msg: string) => process.send!({ type: 'log', level: 'debug', msg }),
};

process.on('message', async (msg: ParentMessage) => {
  if (msg.type === 'init') {
    agentName = msg.agentName;
    try {
      const mod = await import(path.resolve(msg.agentPath));
      const def = mod.default ?? mod;
      agentRun = def.run;
      process.send!({ type: 'ready' });
      // Start heartbeat so the parent watchdog sees this process as alive
      setInterval(() => process.send!({ type: 'heartbeat' }), 5000);
    } catch (err: any) {
      process.send!({ type: 'error', error: err.message });
      process.exit(1);
    }
  }

  if (msg.type === 'event' && agentRun) {
    const ctx = {
      trigger: { type: 'stream', pattern: '*' },
      event: msg.event,
      tools: noopProvider,
      state: noopState,
      ai: noopAi,
      log: noopLog,
    };
    try {
      await agentRun(ctx);
    } catch (err: any) {
      process.send!({ type: 'run_error', error: err.message });
    }
  }

  if (msg.type === 'shutdown') {
    process.exit(0);
  }
});
