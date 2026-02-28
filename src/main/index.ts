declare const LocalMain: any;

export default function main(context: any): void {
  const services = LocalMain.getServiceContainer().cradle;
  const { localLogger } = services;

  localLogger.info('[NexusAI] Addon loading...');

  // Phase 1: Foundation services initialized in later phases
  // Phase 2: Lifecycle hooks (content pipeline)
  // Phase 3: MCP server
  // Phase 4: IPC handlers (UI)

  localLogger.info('[NexusAI] Addon loaded');
}
