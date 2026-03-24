# AI Context File Generation - Requirements & Planning

**Status:** Requirements Discussion
**Target:** Week 3 (March 30 - April 5, 2026)

---

## Overview

Generate a context file in WordPress sites that AI coding assistants (GitHub Copilot, Cursor, Cline, Continue) can read automatically when developers open the site in VS Code.

**User Story:**
> As a developer opening `/Users/jeremy.pollock/Local Sites/nexus-test-site/app/public` in VS Code, I want AI assistants to automatically know about WordPress version, installed plugins, AI Gateway configuration, and development guidelines, so I don't have to manually explain the site architecture in every AI session.

---

## Questions to Answer

### 1. File Naming & Format

**Context:** Different AI tools use different conventions for loading context files.

**Options:**

| File Name | AI Tool | Format | Auto-loaded? | Notes |
|-----------|---------|--------|--------------|-------|
| `.cursorrules` | Cursor AI | Plain text | Yes | Cursor-specific |
| `.github/copilot-instructions.md` | GitHub Copilot | Markdown | Yes | Requires .github dir |
| `CLAUDE.md` | Cline/Claude Code | Markdown | Yes | Often checked into git |
| `.continuerules` | Continue | YAML/Markdown | Yes | Continue-specific |
| `AI-CONTEXT.md` | Generic | Markdown | Manual | Clear intent, any tool |
| `.ai-context.json` | Generic | JSON | Manual | Machine-readable |

**Questions:**

1. **Which file(s) should we generate?**
   - Option A: Single file `AI-CONTEXT.md` (generic, works everywhere with manual load)
   - Option B: Multiple files for each tool (`.cursorrules`, `.github/copilot-instructions.md`, etc.)
   - Option C: User preference (checkbox for each format)

2. **Should the file be checked into git?**
   - If yes: Add to site `.gitignore` so it's excluded
   - If no: Generated locally only (ephemeral)

3. **Should we support JSON format for programmatic access?**
   - Could be useful for custom tooling
   - Adds complexity

**Recommendation:** Start with `AI-CONTEXT.md` (Markdown, simple, readable by humans and AI). Add multi-format support in Phase 2 if needed.

---

### 2. Content Depth & Structure

**Context:** Balance between comprehensive context and overwhelming the AI with too much information.

**Content categories:**

**Minimal (fast, concise):**
- WordPress version
- Active plugins (name, version)
- Active theme
- AI Gateway URL (if configured)

**Standard (recommended):**
- ✅ Minimal +
- PHP version, MySQL version
- File structure (wp-content paths)
- Common WP-CLI commands
- Development guidelines (use hooks, no core mods)

**Comprehensive (maximum context):**
- ✅ Standard +
- MU plugins list
- Custom constants
- ACF field groups
- Cron jobs
- User roles
- Site options (timezone, permalink structure)

**Questions:**

1. **Which content level to start with?**
   - Minimal: ~50 lines
   - Standard: ~150 lines
   - Comprehensive: ~300+ lines

2. **Should we include examples/snippets?**
   - WP-CLI command examples
   - Hook usage patterns
   - AI API call examples

3. **Should we include "what NOT to do" guidelines?**
   - Don't modify core files
   - Don't use globals unnecessarily
   - Prefer hooks over direct modifications

**Recommendation:** Start with **Standard**. Easy to add more detail later if needed.

---

### 3. Generation Triggers

**Context:** When should the file be created/updated?

**Trigger options:**

| Trigger | When | Pros | Cons |
|---------|------|------|------|
| Manual button | User clicks "Generate" in UI | Full control | Requires user action |
| After Setup AI | Plugin installation completes | Automatic for AI-enabled sites | Might be unexpected |
| On site start | Every time site starts | Always fresh | Overhead on every start |
| On site start (if missing) | Only when file doesn't exist | Fresh + minimal overhead | Might miss updates |
| On site start (if stale) | Only if > 7 days old | Fresh when needed | Complexity in staleness check |
| On metadata change | Plugin activated/deactivated | Reactive to changes | Need change detection |

**Questions:**

1. **Primary generation trigger?**
   - Recommended: Manual button + auto-generate after Setup AI

2. **Should we auto-regenerate?**
   - Option A: Never (user must manually regenerate)
   - Option B: On site start if missing
   - Option C: On site start if > 7 days old
   - Option D: When plugins change (detected via cache comparison)

3. **Should regeneration overwrite or merge?**
   - Overwrite: Always fresh, but loses user edits
   - Merge: Preserve user edits, but complex
   - Recommended: **Overwrite** (simple, predictable)

**Recommendation:**
- Primary: Manual button in UI
- Secondary: Auto-generate after Setup AI
- Optional: Regenerate on site start if file is missing

---

### 4. Storage Location

**Context:** Where in the site directory structure should the file live?

**Options:**

| Location | Path | Pros | Cons |
|----------|------|------|------|
| Site root | `/app/public/AI-CONTEXT.md` | Most visible when opening in VS Code | Might clutter root |
| wp-content | `/app/public/wp-content/AI-CONTEXT.md` | Logical location | Less visible |
| .local directory | `/app/public/.local/AI-CONTEXT.md` | Hidden, organized | AI tools might not find it |
| .github directory | `/app/public/.github/ai-context.md` | GitHub convention | Requires .github dir |

**Questions:**

1. **Where should the file be written?**
   - Recommended: **Site root** (`/app/public/AI-CONTEXT.md`)
   - Most visible when opening site in VS Code

2. **Should we create a .gitignore entry?**
   - Add `AI-CONTEXT.md` to site's `.gitignore`
   - Or leave it for user to decide?

3. **Should we support custom location?**
   - User preference in Nexus settings
   - Adds complexity

**Recommendation:** Site root (`/app/public/AI-CONTEXT.md`). Simple, visible, predictable.

---

### 5. Privacy & Security

**Context:** What sensitive information should NOT be included?

**Potentially sensitive data:**

| Data | Risk Level | Action |
|------|------------|--------|
| API keys | 🔴 Critical | **Never include** |
| Gateway tokens | 🔴 Critical | **Mask** (show first 8 chars) |
| Database passwords | 🟡 Medium | Generic only (root/root is default) |
| User emails | 🟡 Medium | **Don't include** |
| Admin usernames | 🟡 Medium | **Don't include** |
| Site URL | 🟢 Low | Include (localhost) |
| Plugin names | 🟢 Low | Include |

**Questions:**

1. **How should we mask tokens?**
   - Option A: `10177933-****-****-****-********70e20`
   - Option B: `10177933-[masked]`
   - Option C: Don't include at all

2. **Should we include database credentials?**
   - Local defaults: `root/root` on `localhost:3306`
   - Generic enough to be safe?
   - Or completely omit?

3. **Should we warn user about file contents?**
   - Show notice: "This file contains site configuration. Don't commit secrets."
   - Or assume file is local-only?

**Recommendation:**
- **Never include:** API keys, real passwords, user PII
- **Mask:** Gateway tokens (show first 8 chars + `****`)
- **Include:** Generic database info (root/root is standard for Local)
- **No warning:** File is local-only, not committed by default

---

### 6. User Experience

**Context:** How does the user interact with this feature?

**UI mockup:**

```
┌─────────────────────────────────────┐
│ AI Development                      │
├─────────────────────────────────────┤
│ AI Context File: Not generated      │
│                                      │
│ [Generate AI Context File]          │
│                                      │
│ Generates a context file that AI    │
│ coding assistants can read when     │
│ opening this site in VS Code.       │
└─────────────────────────────────────┘
```

**After generation:**

```
┌─────────────────────────────────────┐
│ AI Development                      │
├─────────────────────────────────────┤
│ AI Context File: Generated 2m ago   │
│                                      │
│ [Regenerate] [Show in Finder]       │
│                                      │
│ Location: /app/public/AI-CONTEXT.md │
└─────────────────────────────────────┘
```

**Questions:**

1. **Where in the UI?**
   - Option A: New section in Site Info ("AI Development")
   - Option B: In Nexus Site Info section (after AI Setup)
   - Option C: Dedicated "AI Context" tab

2. **What actions to expose?**
   - Generate (always available)
   - Regenerate (only if exists)
   - Show in Finder/Explorer (open file location)
   - Delete (remove file)
   - Copy path (copy file path to clipboard)

3. **Should we show file preview?**
   - First 10 lines of generated file
   - Or just show "✅ Generated"

**Recommendation:**
- **Location:** New section in Nexus Site Info ("AI Development")
- **Actions:** Generate, Regenerate, Show in Finder
- **No preview:** Just show status + file path

---

## Template Preview

**Sample generated file** (Standard content level):

```markdown
# AI Development Context - nexus-test-site

Generated by Local AI Nexus on March 24, 2026

## WordPress Environment

- **WordPress Version:** 7.0-beta6-62094
- **PHP Version:** 8.3.13
- **MySQL:** localhost:10003 (root/root)
- **Site URL:** http://nexus-test-site.local
- **Admin URL:** http://nexus-test-site.local/wp-admin

## Active Plugins

- **AI** (v0.6.0) — WordPress AI Client experiments
- **AI Provider for Local Gateway** (v1.0.0) — Routes AI through Local
- **AI Provider for Ollama** (v1.0.0) — Local AI models
- **Advanced Custom Fields PRO** (v7.0.0) — Custom field management
- **Nexus AI Connector** (v1.0.0) — Local addon integration

## Active Theme

- **Twenty Twenty-Four** (v1.0)

## AI Configuration

- **Gateway:** http://127.0.0.1:13000/ai-gateway/v1
- **Gateway Token:** 10177933-****-****-****-********70e20
- **Provider:** Local Gateway (centralized credential management)
- **Available Models:** Claude Haiku 4.5, Claude Sonnet 4.5, Claude Opus 4.5
- **MU Plugin:** /wp-content/mu-plugins/nexus-ai-gateway-config.php

All AI requests from this site route through the Local AI Gateway for tracking,
rate limiting, and centralized credential management. Usage is tracked in the
Nexus Overview dashboard.

## File Structure

```
/app/public/
├── wp-admin/           WordPress admin
├── wp-content/
│   ├── plugins/        Installed plugins
│   ├── themes/         Installed themes
│   ├── mu-plugins/     Must-use plugins (auto-load)
│   └── uploads/        Media library
├── wp-includes/        WordPress core
└── wp-config.php       Site configuration
```

## Development Guidelines

### WordPress Best Practices

- ✅ **Use hooks (actions/filters)** — Don't modify core files directly
- ✅ **WP-CLI for operations** — Use `wp plugin list`, `wp option get`, etc.
- ✅ **MU plugins auto-load** — No activation needed, just write to mu-plugins/
- ✅ **Debug mode enabled** — Check `/wp-content/debug.log` for errors

### AI Integration

- Use WordPress AI Client library for AI features: `wp_ai_generate_text()`
- AI requests automatically route through Local Gateway
- Don't store API keys in the database — gateway handles credentials
- See `wp-includes/functions-ai.php` for available AI functions

### Common Commands

```bash
# Plugin management
wp plugin list
wp plugin activate <plugin-slug>
wp plugin deactivate <plugin-slug>

# Database operations
wp db query "SELECT * FROM wp_posts WHERE post_type = 'page'"
wp option get siteurl

# Evaluation (run PHP code)
wp eval "echo get_option('blogname');"

# User management
wp user list
wp user create testuser test@example.com --role=editor
```

## Architecture Notes

- **No server restarts needed** — PHP changes reflect on page refresh
- **ACF Pro available** — Use for custom fields on posts/pages/CPTs
- **Graph database** — Nexus addon uses SQLite for site metadata
- **AI Gateway tracking** — All AI usage visible in Nexus Overview dashboard
- **Auto-start/stop** — Halted sites auto-start for operations, then auto-stop

## Debugging

- **PHP errors:** `/wp-content/debug.log` (if `WP_DEBUG_LOG` enabled)
- **Database:** Access via Adminer or SequelPro (localhost:10003, root/root)
- **WP-CLI:** Run commands from Terminal (site must be running)
- **Local logs:** View in Local app → Site → Logs tab

---

*This file is auto-generated by Local AI Nexus. Edit with caution — changes may be overwritten.*
```

**Questions:**

1. **Is this the right level of detail?**
   - Too much? Too little?
   - What would you add or remove?

2. **Is the tone/style appropriate?**
   - Developer-focused
   - Assumes VS Code + AI coding assistant usage

3. **Should we include "Common Pitfalls" section?**
   - Things NOT to do
   - Known issues

**Recommendation:** This template is a good **Standard** starting point. Can iterate based on feedback.

---

## Implementation Checklist

Before starting implementation, confirm decisions on:

- [ ] **File naming:** `AI-CONTEXT.md` vs. multiple formats?
- [ ] **Content level:** Minimal, Standard, or Comprehensive?
- [ ] **Generation triggers:** Manual button + after Setup AI + on-start-if-missing?
- [ ] **Storage location:** Site root (`/app/public/AI-CONTEXT.md`)?
- [ ] **Privacy:** Mask tokens (first 8 chars), no API keys, generic DB credentials?
- [ ] **UI location:** New section in Nexus Site Info ("AI Development")?
- [ ] **Actions:** Generate, Regenerate, Show in Finder?
- [ ] **Template:** Use the sample above as starting point?

---

## Next Steps

1. **Answer all questions above**
2. **Create detailed implementation plan** (Phase 3.1-3.4)
3. **Start Phase 3.1:** Template & Generator class
4. **Build incrementally:** Start minimal, add features iteratively
