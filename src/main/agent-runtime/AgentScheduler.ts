import * as nodeCron from 'node-cron';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, CronTrigger } from '../agent-sdk/types';
import type { AgentRunner } from './AgentRunner';

const logger = createLogger('AgentScheduler');

export class AgentScheduler {
  private tasks = new Map<string, nodeCron.ScheduledTask>();
  private runner: AgentRunner;

  constructor(runner: AgentRunner) {
    this.runner = runner;
  }

  register(agent: AgentDefinition): void {
    const cronTriggers = agent.triggers.filter((t): t is CronTrigger => t.type === 'cron');
    if (cronTriggers.length === 0) return;

    for (const trigger of cronTriggers) {
      if (!nodeCron.validate(trigger.expression)) {
        logger.warn(`AgentScheduler: invalid cron expression "${trigger.expression}" for agent "${agent.name}"`);
        continue;
      }

      const taskKey = `${agent.name}::${trigger.expression}`;
      const task = nodeCron.schedule(trigger.expression, async () => {
        logger.info(`AgentScheduler: firing "${agent.name}" (cron: ${trigger.expression})`);
        try {
          await this.runner.run(agent);
        } catch (err: any) {
          logger.error(`AgentScheduler: unhandled error from runner for "${agent.name}": ${err.message}`);
        }
      });

      this.tasks.set(taskKey, task);
      logger.info(`AgentScheduler: registered "${agent.name}" with cron "${trigger.expression}"`);
    }
  }

  unregister(name: string): void {
    for (const [key, task] of this.tasks.entries()) {
      if (key.startsWith(`${name}::`)) {
        task.stop();
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
