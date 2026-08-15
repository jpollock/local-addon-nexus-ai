/**
 * Process-wide access to the intelligence core for consumers that are wired
 * long after startup (MCP tools, resolvers) — phase-B pragmatism.
 *
 * Threading the core through every constructor chain would touch dozens of
 * files; this registry is the deliberate, documented shortcut. Consumers must
 * treat the core as OPTIONAL (getIntelligenceCore() may return undefined —
 * init failure is non-fatal by design) and degrade to their legacy paths.
 */
import { IntelligenceCore } from './bootstrap';

let core: IntelligenceCore | undefined;

export function setIntelligenceCore(instance: IntelligenceCore): void {
  core = instance;
}

export function getIntelligenceCore(): IntelligenceCore | undefined {
  return core;
}
