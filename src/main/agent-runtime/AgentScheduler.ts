import * as nodeCron from 'node-cron';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, CronTrigger } from '../agent-sdk/types';
import type { AgentRunner } from './AgentRunner';
import { canAutoRun, getAgentCadence } from '../ipc-handlers';
import { resolveAgentCron } from './schedule';

const logger = createLogger('AgentScheduler');

export class AgentScheduler {
  private tasks = new Map<string, nodeCron.ScheduledTask>();
  private runner: AgentRunner;

  constructor(runner: AgentRunner) {
    this.runner = runner;
  }

  register(agent: AgentDefinition): void {
    // If agent is already registered, unregister first to avoid duplicates
    if (Array.from(this.tasks.keys()).some(key => key.startsWith(`${agent.name}::`))) {
      this.unregister(agent.name);
    }

    const cronTriggers = agent.triggers.filter((t): t is CronTrigger => t.type === 'cron');
    if (cronTriggers.length === 0) return;

    for (const t of cronTriggers) {
      if (!nodeCron.validate(t.expression)) {
        logger.warn(`AgentScheduler: invalid cron expression "${t.expression}" for agent "${agent.name}"`);
      }
    }

    // The manifest is the default; a cadence the user explicitly picked in Preferences overrides
    // it. Before this, `cadence` was written by the UI and read by nobody, so the schedule shown
    // to the user was not the schedule that ran.
    const schedule = resolveAgentCron(
      cronTriggers.map(t => t.expression),
      getAgentCadence(agent.name),
      nodeCron.validate,
    );
    if (schedule.ignoredCadence !== undefined) {
      logger.warn(
        `AgentScheduler: ignoring unparseable saved cadence "${schedule.ignoredCadence}" for `
        + `"${agent.name}" — falling back to the manifest schedule`,
      );
    }

    for (const expression of schedule.expressions) {
      const taskKey = `${agent.name}::${expression}`;
      const task = nodeCron.schedule(expression, async () => {
        // Checks `enabled` as well as `scheduleEnabled`. An agent switched off in the UI must
        // not keep firing on its cron — that is how security-sentinel swept the fleet while
        // sitting at {enabled: false}.
        if (!canAutoRun(agent.name, 'schedule')) {
          logger.info(`AgentScheduler: skipping "${agent.name}" — agent or schedule disabled by settings`);
          return;
        }
        logger.info(`AgentScheduler: firing "${agent.name}" (cron: ${expression})`);
        try {
          await this.runner.run(agent, undefined, { trigger: 'cron' });
        } catch (err: unknown) {
          logger.error(`AgentScheduler: unhandled error from runner for "${agent.name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      this.tasks.set(taskKey, task);
      // Naming the source makes a surprising schedule explainable from the log alone — "why is
      // this running every 15 minutes?" is answered by `source=user` without opening settings.
      logger.info(`AgentScheduler: registered "${agent.name}" with cron "${expression}" (source=${schedule.source})`);
    }
  }

  unregister(name: string): void {
    for (const [key, task] of this.tasks.entries()) {
      if (key.startsWith(`${name}::`)) {
        task.stop();
        task.destroy();
        this.tasks.delete(key);
      }
    }
  }

  start(): void {
    for (const task of this.tasks.values()) task.start();
  }

  stop(): void {
    for (const task of this.tasks.values()) task.stop();
    this.tasks.clear();
  }
}
