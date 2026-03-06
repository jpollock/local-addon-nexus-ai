# Lightning Services Architecture & AI Leverage Analysis

**Purpose:** Technical reference for how Local's Lightning Services system works, and analysis of how it could serve as infrastructure for the AI vision described in `local-ai-vision.md`. Written to be consumed by another AI or engineer unfamiliar with the codebase.

**Codebase:** `flywheel-local` (the Local by Flywheel Electron app)

---

## Part 1: How Lightning Services Work

### What They Are

Lightning Services are Local's abstraction for managed native binaries — PHP, MySQL/MariaDB, Nginx, and Mailpit. Each is a self-contained package with binaries for every platform, Handlebars config templates, and a TypeScript class that implements the `LightningService` interface. They are the infrastructure layer that makes "just click Start" possible.

The key insight: **Lightning Services are addons.** They use the same addon loading system as third-party plugins. The only difference is they ship in `extraResources/lightning-services/` instead of `~/Library/Application Support/Local/addons/`. This means the system was designed from the start to accommodate new service types.

### The Service Contract

Every Lightning Service extends a base class (`app/main/sites/LightningService.ts`) and implements this contract:

```
Identity:        serviceName, label, binVersion
File system:     bins (per-platform binary paths), configTemplatePath, configPath, runPath, logsPath
Networking:      requiredPorts (what ports it needs), ports (allocated ports), socket (unix socket path)
Configuration:   configVariables (values injected into Handlebars templates), env (environment variables)
Lifecycle:       preprovision() → provision() → start() → stop() → finalizeNewSite()
```

The `start()` method is the core — it returns an array of `IProcessOpts` describing what child processes to spawn:

```typescript
start(): IProcessOpts[] {
    return [{
        name: 'PHP-FPM',
        binPath: this.bin.phpFpm,
        args: ['-F', '--fpm-config', path.join(this.configPath, 'php-fpm.conf')],
        env: { ...process.env, ...this.env },
        autoRestartMaxTries: 3,
    }];
}
```

A service can return multiple processes. The system spawns them all in parallel via `ProcessGroup`.

### Service Roles

Services fill abstract roles, not just named slots:

| Role | Services | Access Pattern |
|------|----------|----------------|
| `PHP` | php | `site.getSiteServiceByRole(SiteServiceRole.PHP)` |
| `DATABASE` | mysql, mariadb | `site.getSiteServiceByRole(SiteServiceRole.DATABASE)` |
| `HTTP` | nginx, apache | `site.getSiteServiceByRole(SiteServiceRole.HTTP)` |
| *(none)* | mailpit | accessed by name only |

Role-based access means the system doesn't care *which* database you're running — it asks for "the DATABASE service" and gets back whatever's configured. This is important for extensibility.

### Package Structure on Disk

Each service is a directory under `lightning-services/`:

```
php-8.2.29+0/
├── package.json          # name, version, main entry, tags
├── lib/
│   ├── main.js           # Registration: calls registerLightningService(PhpService, 'php', '8.2.29')
│   └── PhpService.js     # The service class
├── conf/
│   ├── php.ini.hbs       # Handlebars templates → compiled per-site
│   ├── php-fpm.conf.hbs
│   └── php-fpm.d/
└── bin/
    ├── darwin/            # macOS Intel binaries
    ├── darwin-arm64/      # macOS Apple Silicon binaries
    ├── linux/
    ├── win32/
    └── win64/
```

The `package.json` tags (`local-lightning-service`, `local-site-service`) are how the addon loader identifies these as services vs. regular addons.

### Registration & Discovery

```
App starts
  → AddonLoaderService.loadAddonsInRepos() scans lightning-services/ and addons/
  → For each package with a main entry: require(main.js)
  → main.js calls registerLightningService(ServiceClass, name, binVersion)
  → Stored in module-level registry: _registeredServices['php']['8.2.29'] = PhpService
```

When a site needs a service:
```
LightningServicesService.getSiteService(site, 'php')
  → Reads site.services.php.version (e.g., '8.2.29')
  → Looks up _registeredServices['php']['8.2.29']
  → Falls back to highest available patch version (semver-aware)
  → Returns new PhpService(site, lightningServicesService)
```

### The Full Site Start Sequence

This is the complete flow when a user clicks "Start Site":

```
1. SiteProcessManagerService.start(site)
2. lightningServices.maybeDownload(site)        — fetch missing service binaries from CDN
3. _maybeAllocateMissingPorts(site)             — find available TCP ports
4. ports.checkAndReplaceUnavailablePorts(site)  — swap if ports are taken
5. configTemplates.compileServiceConfigs(site)  — render .hbs → real configs
6. lightningServices.getSiteServices(site)      — instantiate all service classes
7. For each service:
   a. service.preprovision()                    — create dirs, prep filesystem
   b. service.start() → IProcessOpts[]         — get process spawn instructions
   c. new Process(opts) for each                — wrap in Process class
8. ProcessGroup.startAll()                      — spawn all child processes in parallel
9. siteDatabase.waitForDB(site)                 — poll until MySQL/MariaDB is ready
10. service.provision()                         — post-start setup (create DBs, users)
11. router.restart()                            — reconfigure nginx router for this site
12. updateSiteStatus(site, 'running')
```

### Configuration System (Handlebars Templates)

Services don't hardcode configs. They provide `.hbs` template files and a `configVariables` object. At site start, `ConfigTemplatesService` compiles them:

```handlebars
; php.ini.hbs
extension_dir = "{{extensionsDir}}"
error_log = "{{logs.errorLog}}"
sendmail_path = "/usr/bin/env catchmail --smtp-ip {{mail.smtpAddr}} --smtp-port {{mail.smtpPort}}"
```

The service class provides the variables:
```typescript
get configVariables() {
    return {
        extensionsDir: path.join(this.$PATH, '..', 'lib', 'php', 'extensions'),
        logs: { errorLog: path.join(this.logsPath, 'php-error.log') },
        mail: {
            smtpAddr: '127.0.0.1',
            smtpPort: this.mailpitService?.ports?.SMTP[0]?.port || 1025
        }
    };
}
```

This means **any service can reference any other service's ports, paths, or config** at template compile time. Inter-service wiring is declarative.

### Inter-Service Communication

Services interact through three mechanisms:

1. **Port sharing** — Services declare `requiredPorts`, get allocated ports, and other services read them via `service.ports.KEY[0].port`
2. **Unix sockets** — PHP-FPM exposes a socket; Nginx connects to it via `fastcgi_pass unix:{{phpSocket}}`
3. **Environment variables** — Services extend `$PATH` and set custom env vars that child processes inherit

### Version Management & Hot-Swapping

Services can be swapped on a running site:

```
SiteProvisionerService.swapService(site, 'php', 'php', '8.3.0')
  → Stops site
  → Updates site.services.php.version
  → Re-compiles config templates
  → Starts site with new service
```

Preferred (default) versions are defined in `app/shared/constants/lightningServices.ts`:
```typescript
export const preferredVersions = {
    php: { binVersion: '8.2.29' },
    nginx: { binVersion: '1.26.1' },
    mysql: { binVersion: '8.0.35' },
    mariadb: { binVersion: '10.6.23' },
    mailpit: { binVersion: '1.24.1' },
};
```

### How Mailpit Was Added (The Most Recent Service)

Mailpit is instructive because it was added after the original three (PHP, MySQL, Nginx). It demonstrates the extensibility pattern:

- Has its own package under `lightning-services/mailpit-1.24.1+0/`
- Implements `LightningService` with `serviceName: 'mailpit'`
- Has **no role** (it's not PHP, DATABASE, or HTTP) — it's a utility service
- Other services reference it: PHP's config reads Mailpit's SMTP port
- Added to `preferredVersions` and `getPreferredServices()` in shared utils
- Requires no changes to core site management code

### Hooks for Extending Services

Addons can modify which services a site gets via the `defaultSiteServices` filter:

```typescript
HooksMain.addFilter('defaultSiteServices', (services, siteSettings) => {
    services.redis = {
        name: 'redis',
        version: '7.0.0',
        type: Local.SiteServiceType.LIGHTNING,
    };
    return services;
});
```

This is how an addon could inject a new service into every site without modifying Local's core.

---

## Part 2: Key Files Reference

| File | What It Does |
|------|-------------|
| `app/main/sites/LightningService.ts` | Base class every service extends |
| `app/main/sites/LightningServicesService.ts` | Service registry, discovery, download orchestration |
| `app/main/sites/LightningServicesUpdaterService.ts` | Version updates across all sites |
| `app/main/sites/SiteProcessManagerService.ts` | The orchestrator — starts/stops sites and their services |
| `app/main/sites/SiteProvisionerService.ts` | Creates site dirs, copies templates, handles service swaps |
| `app/main/sites/ConfigTemplatesService.ts` | Handlebars template compilation |
| `app/main/sites/processes/Process.ts` | Child process wrapper with auto-restart, logging |
| `app/main/sites/processes/ProcessGroup.ts` | Manages multiple processes as a unit |
| `app/main/addons/AddonLoaderService.ts` | Discovers and loads addons (including Lightning Services) |
| `app/shared/constants/lightningServices.ts` | Preferred version definitions |
| `app/shared/helpers/LightningServiceSharedUtils.ts` | Utility functions for service names, roles, version parsing |
| `app/main/serviceContainer.ts` | Awilix DI container — where all services are wired together |

---

## Part 3: Leverage Analysis for AI Vision

### The Architectural Opportunity

The vision doc describes Local becoming "the tool that makes AI infrastructure invisible" — running LLMs, vector databases, and AI tooling alongside WordPress sites the same way it runs PHP, MySQL, and Nginx today.

Lightning Services is the natural vehicle for this. The system was built to manage exactly this kind of infrastructure: native binaries that need configuration, port allocation, process lifecycle management, and inter-service wiring. Here's how the pieces map.

### Concrete Leverage Points

#### 1. Ollama as a Lightning Service

**What:** Package Ollama (local LLM runtime) as a Lightning Service that starts with Local and is available to all sites.

**How it fits:**
- Ollama is a single binary with a REST API — simpler than PHP-FPM or MySQL
- It needs: one HTTP port, a data directory for models, environment config
- The `LightningService` contract handles all of this naturally
- It would have **no role** (like Mailpit) — it's a utility service, not per-site infrastructure
- Other services (PHP, WordPress plugins) reference it via its allocated port

**Key difference from existing services:** Ollama would be fleet-wide, not per-site. Today, each Lightning Service instance is scoped to a single site. Ollama should run once and serve all sites. This is a pattern Local doesn't have yet — the closest analog is the Router (nginx running globally), but the Router isn't a Lightning Service, it's a separate system.

**Options:**
- **(a) One instance, fleet-wide.** Start Ollama once when Local launches, not per-site. This requires either making it a special global service (like the Router) or introducing a new concept of "shared services" that multiple sites can consume. The Router precedent in `app/main/router/` shows Local already has this pattern, just not formalized in the Lightning Service system.
- **(b) Per-site instances.** Each site gets its own Ollama. Wasteful for LLM inference (models are large, GPU is shared), but fits the existing architecture perfectly. Could work for lightweight models.
- **(c) Hybrid.** Register Ollama as a Lightning Service for lifecycle management, but use a singleton pattern — first site to start it wins, others get the same port. The service class would check "is Ollama already running?" before spawning.

**Recommendation:** Option (c) in the short term. Option (a) formalized as "Shared Services" in the medium term. This introduces a valuable new primitive to the platform.

#### 2. Vector Database as a Lightning Service

**What:** Package a vector DB (ChromaDB, Qdrant, or similar) for local embeddings and semantic search.

**How it fits:**
- Same pattern as Ollama — single binary, REST API, needs a port and data directory
- Could be per-site (each site gets its own vector collection) or fleet-wide
- Per-site makes more sense here than for LLMs — embeddings are site-specific content
- WordPress plugin connects to `localhost:{allocated_port}` — the port is in the site's service config

**Architecture decision:** Per-site or fleet-wide?
- Per-site: simpler, fits existing model, but more resource usage
- Fleet-wide with per-site collections: more efficient, but requires the "shared service" pattern
- A single vector DB instance with namespace isolation (collections per site) is the pragmatic choice

#### 3. The "Shared Services" Concept

The AI vision surfaces a gap in the current architecture: **services that are fleet-wide rather than site-scoped.**

Today's model:
```
Site A → [PHP, MySQL, Nginx, Mailpit]  (all instances scoped to Site A)
Site B → [PHP, MySQL, Nginx, Mailpit]  (all instances scoped to Site B)
```

The AI model:
```
Fleet → [Ollama, VectorDB, AI Gateway]  (shared across all sites)
Site A → [PHP, MySQL, Nginx, Mailpit]   (site-scoped as today)
Site B → [PHP, MySQL, Nginx, Mailpit]   (site-scoped as today)
```

The Router (`app/main/router/`) already implements this pattern informally — it's a global Nginx instance that routes to all sites. Formalizing "shared services" as a first-class concept would:
- Give AI services a natural home
- Allow them to participate in the same lifecycle management (start/stop with Local, port allocation, logging)
- Make them discoverable via the same `lightningServices.getRegisteredServices()` API
- Surface them in the MCP tool set naturally

#### 4. AI Gateway via Config Templates

**What:** The vision describes an "AI Gateway" — unified management of API keys, model routing, and cost visibility.

**How it fits:** This could be a Lightning Service that acts as a reverse proxy for AI API calls. The Handlebars config system is perfect for this:

```handlebars
; ai-gateway.conf.hbs
listen_port = {{ports.HTTP}}

[providers]
openai_key = "{{gateway.openaiKey}}"
anthropic_key = "{{gateway.anthropicKey}}"

[routing]
default_provider = "{{gateway.defaultProvider}}"
local_model_url = "http://127.0.0.1:{{ollama.port}}"
```

The `configVariables` system already supports cross-service references. An AI Gateway service could read Ollama's port from the service registry and route requests to local models or external APIs based on configuration.

#### 5. MCP as the Control Plane Interface

**What:** The vision doc says MCP is "the universal adapter." Lightning Services + MCP = a powerful combination.

**How it fits today:**
- The MCP addon (`local-addon-cli-mcp`) already has access to `lightningServices` via `LocalServices` interface
- It can call `getRegisteredServices()` and `getServices()` to discover what's available
- New AI services registered as Lightning Services would automatically be visible to MCP tools

**What's missing:**
- MCP tools for managing AI-specific services (start/stop Ollama, load models, query vector DB)
- MCP resources for AI service status (is Ollama running? what models are loaded? vector DB health?)
- The MCP addon's `_localServices` object doesn't currently wire up `lightningServices` for use by MCP tools — but the type interface already defines it as optional, so wiring it is trivial

#### 6. WordPress Plugin ↔ Lightning Service Communication

**What:** The vision describes AI capabilities surfacing in WP Admin via a plugin.

**How it fits:** This is exactly how Mailpit works today:
1. Mailpit runs as a Lightning Service with an SMTP port and a web UI port
2. PHP's config is templated to use Mailpit's SMTP port for `sendmail_path`
3. WordPress sends mail normally → Mailpit intercepts it

The same pattern for AI:
1. Ollama runs as a Lightning Service on an allocated port
2. A WordPress plugin reads the port from a well-known location (wp-config.php constant, environment variable, or a Local-injected mu-plugin)
3. The plugin calls `http://localhost:{port}/api/generate` for LLM inference
4. No API keys needed, no data leaving the machine

**The injection mechanism already exists:** PHP services use `auto_prepend_file` in php.ini to bootstrap Local-specific behavior. A similar approach could inject AI service endpoints into WordPress's runtime:

```php
// auto_prepend_file: local-ai-bootstrap.php
define('LOCAL_AI_OLLAMA_URL', 'http://127.0.0.1:11434');
define('LOCAL_AI_VECTORDB_URL', 'http://127.0.0.1:6333');
```

### What Requires New Architecture vs. What Fits Today

| Capability | Fits Existing Architecture? | What's Needed |
|-----------|---------------------------|---------------|
| Ollama as a managed binary | Yes — it's a service with a binary, port, and config | New Lightning Service package |
| Vector DB per site | Yes — same as MySQL, per-site instance | New Lightning Service package |
| Fleet-wide shared services | **No** — current model is per-site | New "shared service" concept (Router is informal precedent) |
| AI Gateway proxy | Yes — it's a service with config templates | New Lightning Service package |
| Cross-service config wiring | Yes — Handlebars templates already do this | Just use `configVariables` |
| MCP exposure of AI services | Yes — `lightningServices` is in the MCP addon type | Wire it up, add tools |
| WordPress plugin integration | Yes — follows the Mailpit pattern exactly | `auto_prepend_file` or mu-plugin injection |
| Model management UI | Partially — service exists, but UI is React/renderer side | New renderer components |
| Cost tracking / observability | **No** — nothing in Lightning Services for metering | New capability, could be an addon |

### Recommended Sequencing

**Phase 1 — Prove the pattern:**
Add Ollama as a Lightning Service. Singleton/hybrid approach. Gets the binary management, port allocation, and process lifecycle for free. Wire it into MCP so Claude Code can query it. This validates that the Lightning Service architecture works for AI infrastructure without modifying Local's core.

**Phase 2 — Add vector search:**
Add a vector DB as a Lightning Service. Per-site instances with embeddings of WordPress content (posts, pages, ACF fields). Expose via MCP as a resource. This delivers the "fleet-aware, semantic search across your sites" capability.

**Phase 3 — Formalize shared services:**
Extract the Router's "global service" pattern into a first-class concept. Migrate Ollama to this model. This unlocks fleet-wide AI infrastructure properly.

**Phase 4 — WordPress integration:**
Build the WordPress plugin that consumes Local's AI services. Use `auto_prepend_file` injection to pass service endpoints. This delivers the "AI capabilities in WP Admin" piece.

**Phase 5 — AI Gateway:**
Build the gateway service for API key management, model routing, and cost visibility. This is where the "Local manages your AI infrastructure" story becomes complete.

### Risks and Open Questions

1. **Resource constraints.** LLMs are heavy. Ollama + a vector DB + PHP + MySQL + Nginx on a developer laptop is a lot. The system needs clear resource management that Lightning Services don't currently provide (no CPU/memory limits on spawned processes).

2. **GPU access.** Ollama needs GPU access for reasonable performance. Lightning Services spawn child processes — GPU passthrough should work, but hasn't been tested in this context.

3. **Model storage.** LLM models are large (4-30GB). Where do they live? Lightning Services have a data directory pattern, but model management is a different concern than service config.

4. **The singleton problem.** Lightning Services are fundamentally per-site. Making Ollama fleet-wide is the right UX but fights the architecture. The Router is the precedent, but it's hand-wired, not a formalized pattern. This needs deliberate design.

5. **Startup time.** Adding AI services to the site start sequence could make "Start Site" noticeably slower if Ollama needs to load a model. The sequence should be: start WordPress services first, start AI services in the background.

6. **Version management.** Ollama updates frequently. The Lightning Services updater system works, but the download sizes for LLM runtimes + models are much larger than PHP binaries. The CDN/download infrastructure may need to accommodate this.
