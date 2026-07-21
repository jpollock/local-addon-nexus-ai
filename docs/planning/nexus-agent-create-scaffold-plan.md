# nexus agent create — Scaffold Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `nexus agent create` generates `nexus.agent.yaml` alongside `agent.ts`, supports `--mode run|tools|both`, and `nexus agent tools build` creates the manifest if missing.

**Architecture:** Single-file change — `src/cli/commands/agent.ts`. Three new template strings, one updated handler, one updated CLI registration, one updated build action.

**Tech Stack:** TypeScript, Commander, js-yaml (already in deps)

## Global Constraints

- `handleAgentCreate` signature adds `mode?: 'run' | 'tools' | 'both'` as third param (after existing `_agentsDir?`) — preserves all existing tests
- Default mode is `'run'` — no change to existing `nexus agent create <name>` behaviour beyond writing the manifest
- `nexus.agent.yaml` tier defaults to `1` with an inline comment explaining when to raise it
- `nexus agent tools build` creates a minimal manifest when none exists, then proceeds to generate `contributes`; the minimal manifest uses `def.name`, `def.version ?? '1.0.0'`, `def.description ?? ''`
- Tests run with: `npm test -- --testPathPattern="agent-commands" --no-coverage`

---

## File Map

### Modified files
| File | What changes |
|------|-------------|
| `src/cli/commands/agent.ts` | New template constants; updated `handleAgentCreate`; updated `create` CLI registration; updated `tools build` action |

### Test file
| File | What changes |
|------|-------------|
| `tests/unit/cli/agent-commands.test.ts` | New tests for `--mode tools`, `--mode both`, manifest generation, `build` with missing manifest |

---

## Task 1: Templates + `handleAgentCreate` update

**Files:**
- Modify: `src/cli/commands/agent.ts` — add templates, update handler and CLI registration
- Test: `tests/unit/cli/agent-commands.test.ts` — new create tests

**Interfaces:**
- Produces: `handleAgentCreate(name, _agentsDir?, mode?)` — same external contract, `mode` is new optional third param

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cli/agent-commands.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { handleAgentCreate } from '../../../src/cli/commands/agent';

describe('handleAgentCreate — manifest generation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-create-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('default (run) mode creates agent.ts and nexus.agent.yaml', async () => {
    await handleAgentCreate('my-agent', tmpDir);
    const agentDir = path.join(tmpDir, 'my-agent');
    expect(fs.existsSync(path.join(agentDir, 'agent.ts'))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, 'nexus.agent.yaml'))).toBe(true);
  });

  it('default manifest has name, tier: 1, and cron trigger', async () => {
    await handleAgentCreate('my-agent', tmpDir);
    const raw = fs.readFileSync(path.join(tmpDir, 'my-agent', 'nexus.agent.yaml'), 'utf8');
    const manifest = yaml.load(raw) as Record<string, unknown>;
    expect(manifest.name).toBe('my-agent');
    expect((manifest.permissions as Record<string, unknown>).tier).toBe(1);
    const triggers = manifest.triggers as Array<Record<string, unknown>>;
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe('cron');
  });

  it('tools mode agent.ts contains contributes.tools and no run()', async () => {
    await handleAgentCreate('my-agent', tmpDir, 'tools');
    const src = fs.readFileSync(path.join(tmpDir, 'my-agent', 'agent.ts'), 'utf8');
    expect(src).toContain('contributes');
    expect(src).toContain('executionMode');
    expect(src).not.toContain('async run(');
  });

  it('tools mode manifest has no triggers', async () => {
    await handleAgentCreate('my-agent', tmpDir, 'tools');
    const raw = fs.readFileSync(path.join(tmpDir, 'my-agent', 'nexus.agent.yaml'), 'utf8');
    const manifest = yaml.load(raw) as Record<string, unknown>;
    expect(manifest.triggers == null || (manifest.triggers as unknown[]).length === 0).toBe(true);
  });

  it('both mode agent.ts contains run() and contributes.tools', async () => {
    await handleAgentCreate('my-agent', tmpDir, 'both');
    const src = fs.readFileSync(path.join(tmpDir, 'my-agent', 'agent.ts'), 'utf8');
    expect(src).toContain('async run(');
    expect(src).toContain('contributes');
  });

  it('both mode manifest has cron trigger', async () => {
    await handleAgentCreate('my-agent', tmpDir, 'both');
    const raw = fs.readFileSync(path.join(tmpDir, 'my-agent', 'nexus.agent.yaml'), 'utf8');
    const manifest = yaml.load(raw) as Record<string, unknown>;
    const triggers = manifest.triggers as Array<Record<string, unknown>>;
    expect(triggers?.[0]?.type).toBe('cron');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- --testPathPattern="agent-commands" --no-coverage 2>&1 | grep -E "FAIL|PASS|●" | head -10
```

Expected: tests fail (manifest generation doesn't exist yet).

- [ ] **Step 3: Add template constants before `AGENT_TEMPLATE`**

Add these three new constants to `src/cli/commands/agent.ts`, immediately before the existing `const AGENT_TEMPLATE` definition:

```typescript
const MANIFEST_TEMPLATE = (name: string, withTriggers: boolean) => {
  const doc: Record<string, unknown> = {
    name,
    version: '1.0.0',
    description: 'Describe what this agent does',
    permissions: { tier: 1 }, // raise to 2 (reversible writes) or 3 (production mutations) as needed
    tools: [],
  };
  if (withTriggers) {
    doc.triggers = [{ type: 'cron', expression: '0 2 * * *' }];
  }
  return (
    '# nexus.agent.yaml — agent manifest\n' +
    '# Run: nexus agent tools build  →  regenerates the contributes section from agent.ts\n\n' +
    yaml.dump(doc)
  );
};

const AGENT_TOOLS_TEMPLATE = (name: string) => `import { defineAgent } from '@nexus-ai/agent-sdk';
import { z } from 'zod';

export default defineAgent({
  name: '${name}',
  version: '1.0.0',
  description: 'Describe what this agent does',
  tools: [],

  contributes: {
    tools: {
      my_tool: {
        description: 'Describe what this tool does',
        schema: z.object({
          siteId: z.string().describe('Target site ID'),
        }),
        executionMode: 'function' as const,
        handler: async (args, ctx) => {
          ctx.log.info('my_tool: starting', { siteId: args.siteId });
          // TODO: implement
          return { content: [{ type: 'text' as const, text: 'done' }] };
        },
      },
    },
  },
});
`;

const AGENT_BOTH_TEMPLATE = (name: string) => `import { defineAgent, cron } from '@nexus-ai/agent-sdk';
import { z } from 'zod';

export default defineAgent({
  name: '${name}',
  version: '1.0.0',
  description: 'Describe what this agent does',
  triggers: [cron('0 2 * * *')],
  tools: ['nexus_list_sites'],

  contributes: {
    tools: {
      my_tool: {
        description: 'Describe what this tool does',
        schema: z.object({
          siteId: z.string().describe('Target site ID'),
        }),
        executionMode: 'function' as const,
        handler: async (args, ctx) => {
          ctx.log.info('my_tool: starting', { siteId: args.siteId });
          // TODO: implement
          return { content: [{ type: 'text' as const, text: 'done' }] };
        },
      },
    },
  },

  async run({ tools, state, log }) {
    log.info('${name}: starting scheduled run');
    const sites = await tools.invoke('nexus_list_sites', {});
    log.info(\`Found \${Array.isArray(sites) ? sites.length : 0} site(s)\`);
    state.set('lastRunAt', Date.now());
    log.info('${name}: done');
  },
});
`;
```

Note: `yaml` is already imported at the top of the file. Verify before adding a duplicate import.

- [ ] **Step 4: Update `handleAgentCreate`**

Replace the existing `handleAgentCreate` function body with:

```typescript
export async function handleAgentCreate(
  name: string,
  _agentsDir?: string,
  mode: 'run' | 'tools' | 'both' = 'run',
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(
      `Error: agent name must be lowercase letters, numbers, and hyphens (got: "${name}")`,
    );
    process.exit(1);
  }

  const agentsRoot =
    _agentsDir ??
    path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents');

  const agentDir = path.join(agentsRoot, name);

  if (fs.existsSync(agentDir)) {
    console.error(`Error: agent "${name}" already exists at ${agentDir}`);
    process.exit(1);
  }

  fs.mkdirSync(agentDir, { recursive: true });

  const agentSrc =
    mode === 'tools' ? AGENT_TOOLS_TEMPLATE(name) :
    mode === 'both'  ? AGENT_BOTH_TEMPLATE(name) :
                       AGENT_TEMPLATE(name);

  const manifestSrc = MANIFEST_TEMPLATE(name, mode !== 'tools');

  fs.writeFileSync(path.join(agentDir, 'agent.ts'), agentSrc, 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), manifestSrc, 'utf-8');

  console.log(`Created: ${path.join(agentDir, 'agent.ts')}`);
  console.log(`Created: ${path.join(agentDir, 'nexus.agent.yaml')}`);
  console.log('');
  console.log(`Next: edit agent.ts, then run: nexus agent tools build ${name}`);
  console.log(`      nexus agent run ${name}   (manually trigger)`);
  console.log(`      Watch it reload automatically when you save the file.`);
}
```

- [ ] **Step 5: Update the CLI `create` command registration**

Find the block:
```typescript
agentCommand
  .command('create <name>')
  .description('Scaffold a new TypeScript agent')
  .action(async (name: string) => {
    await handleAgentCreate(name);
  });
```

Replace with:
```typescript
agentCommand
  .command('create <name>')
  .description('Scaffold a new TypeScript agent')
  .option(
    '--mode <mode>',
    'Scaffold mode: run (cron + run()), tools (contributes.tools), both (cron + run() + contributes.tools)',
    'run',
  )
  .action(async (name: string, opts: { mode: string }) => {
    const mode = opts.mode as 'run' | 'tools' | 'both';
    if (!['run', 'tools', 'both'].includes(mode)) {
      console.error(`Error: --mode must be run, tools, or both (got: "${opts.mode}")`);
      process.exit(1);
    }
    await handleAgentCreate(name, undefined, mode);
  });
```

- [ ] **Step 6: Run tests**

```bash
npm test -- --testPathPattern="agent-commands" --no-coverage 2>&1 | tail -15
```

Expected: 6 new create tests pass; all pre-existing agent-commands tests still pass.

- [ ] **Step 7: Build check**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

Expected: clean.

- [ ] **Step 8: Smoke test the CLI**

```bash
node lib/cli/index.js agent create --help
# Should show --mode option

TMP=$(mktemp -d)
node lib/cli/index.js agent create test-agent --mode tools -- "$TMP" 2>&1 || true
# Or test handleAgentCreate directly in node REPL
node -e "
const {handleAgentCreate} = require('./lib/cli/commands/agent');
const os = require('os'), path = require('path'), fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
handleAgentCreate('smoke-test', tmp, 'tools').then(() => {
  console.log('agent.ts:', fs.readFileSync(path.join(tmp, 'smoke-test', 'agent.ts'), 'utf8').slice(0, 200));
  console.log('manifest:', fs.readFileSync(path.join(tmp, 'smoke-test', 'nexus.agent.yaml'), 'utf8'));
  fs.rmSync(tmp, {recursive:true});
});
"
```

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/agent.ts tests/unit/cli/agent-commands.test.ts
git commit -m "feat(cli): nexus agent create --mode run|tools|both + manifest generation"
```

---

## Task 2: `nexus agent tools build` — create manifest if missing

**Files:**
- Modify: `src/cli/commands/agent.ts` — update the `tools build` action body

**Interfaces:**
- Consumes: `def.name`, `def.version`, `def.description` from the loaded agent module
- Behaviour change: no longer exits when `nexus.agent.yaml` is missing; creates a minimal manifest instead

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli/agent-commands.test.ts`:

```typescript
import { handleAgentToolsBuild } from '../../../src/cli/commands/agent';

describe('handleAgentToolsBuild — create manifest if missing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-build-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates nexus.agent.yaml when missing', async () => {
    // Write a minimal compiled agent.js with no contributes
    const agentJs = `
      module.exports = { default: {
        name: 'auto-agent', version: '2.0.0', description: 'Auto created',
        contributes: { tools: {} }
      }};
    `;
    fs.writeFileSync(path.join(tmpDir, 'agent.js'), agentJs);
    // No nexus.agent.yaml yet

    await handleAgentToolsBuild(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, 'nexus.agent.yaml'))).toBe(true);
    const raw = fs.readFileSync(path.join(tmpDir, 'nexus.agent.yaml'), 'utf8');
    const manifest = yaml.load(raw) as Record<string, unknown>;
    expect(manifest.name).toBe('auto-agent');
    expect((manifest.permissions as Record<string, unknown>).tier).toBe(1);
  });

  it('updates existing manifest contributes section', async () => {
    const agentJs = `
      module.exports = { default: {
        name: 'my-agent', version: '1.0.0',
        contributes: { tools: { ping: { description: 'Ping', schema: null, executionMode: 'function', handler: async () => ({content:[{type:'text',text:'pong'}]}) } } }
      }};
    `;
    fs.writeFileSync(path.join(tmpDir, 'agent.js'), agentJs);
    fs.writeFileSync(path.join(tmpDir, 'nexus.agent.yaml'), 'name: my-agent\nversion: 1.0.0\n');

    await handleAgentToolsBuild(tmpDir);

    const raw = fs.readFileSync(path.join(tmpDir, 'nexus.agent.yaml'), 'utf8');
    expect(raw).toContain('ping');
    expect(raw).toContain('Ping');
  });
});
```

Note: this test requires `handleAgentToolsBuild` to be exported. Export it alongside the other `handle*` functions.

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- --testPathPattern="agent-commands" --no-coverage 2>&1 | grep "handleAgentToolsBuild\|create manifest" | head -5
```

Expected: test errors (function not exported / manifest existence check blocks it).

- [ ] **Step 3: Extract and update the build handler**

In the `tools build` action, replace the hard-exit when manifest is missing with creation of a default manifest, and extract the logic into an exported `handleAgentToolsBuild` function:

Find this block inside the `tools build` action:
```typescript
if (!fsMod.existsSync(manifestPath)) {
  console.error(`nexus.agent.yaml not found at ${manifestPath}`);
  process.exit(1);
}
```

Replace with:
```typescript
if (!fsMod.existsSync(manifestPath)) {
  // Create a minimal manifest from the agent definition
  const minimalManifest = {
    name: def?.name ?? pathMod.basename(resolvedPath),
    version: def?.version ?? '1.0.0',
    description: def?.description ?? '',
    permissions: { tier: 1 },
    tools: [],
  };
  fsMod.writeFileSync(
    manifestPath,
    '# nexus.agent.yaml — created by nexus agent tools build\n' +
    '# Run: nexus agent tools build  →  regenerates the contributes section\n\n' +
    yaml.dump(minimalManifest),
    'utf8',
  );
  console.log(`Created: ${manifestPath}`);
}
```

Then extract the entire action body into:
```typescript
export async function handleAgentToolsBuild(agentPath?: string, checkOnly = false): Promise<void> {
  // ... move action body here ...
}
```

And call it from the action:
```typescript
.action(async (agentPath: string | undefined, options: { check?: boolean }) => {
  await handleAgentToolsBuild(agentPath, options.check);
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="agent-commands" --no-coverage 2>&1 | tail -15
```

Expected: all agent-commands tests pass including the 2 new build tests.

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/agent.ts tests/unit/cli/agent-commands.test.ts
git commit -m "feat(cli): nexus agent tools build creates manifest if missing; extract handleAgentToolsBuild"
```
