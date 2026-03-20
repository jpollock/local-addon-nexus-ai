# Quick Review Checklist

Fast review of the documentation in 15 minutes.

## 1. Automated Check (2 min)

```bash
cd docs-site

# Run validation script
./scripts/validate-docs.sh

# Should see:
# ✓ Documentation validation passed!
```

If errors, fix them first.

## 2. Local Preview (5 min)

```bash
# Serve docs locally
mkdocs serve

# Open http://127.0.0.1:8000
```

**Click through:**

- [ ] Homepage loads correctly
- [ ] Navigation menu works
- [ ] Search bar appears and works
- [ ] Code blocks have syntax highlighting
- [ ] Mermaid diagrams render

## 3. Key Pages Review (5 min)

Quick spot-check these critical pages:

### Homepage (`index.md`)
- [ ] Architecture diagram shows
- [ ] Quick start buttons work
- [ ] Clear value proposition

### CLI Quick Start (`getting-started/cli-quick-start.md`)
- [ ] Installation command is correct
- [ ] First steps are clear
- [ ] Examples work

### Claude Desktop (`integrations/claude-desktop.md`)
- [ ] JSON config is valid
- [ ] File paths are correct (macOS/Windows/Linux)
- [ ] Troubleshooting is helpful

### CLI Commands (`reference/cli-command-reference.md`)
- [ ] Commands are accurate
- [ ] Examples are correct
- [ ] Tables render properly

## 4. Mobile Check (2 min)

```bash
# Still running mkdocs serve
```

In browser:
- [ ] Resize window to narrow (mobile width)
- [ ] Menu collapses to hamburger
- [ ] Content is readable
- [ ] Tables don't overflow

## 5. Link Check (1 min)

```bash
# Build in strict mode
mkdocs build --strict

# Should complete without warnings
# If warnings appear, fix broken links
```

## Issues to Look For

### Critical (must fix)
- ❌ Broken internal links
- ❌ Invalid JSON in code examples
- ❌ Unclosed code blocks
- ❌ Broken Mermaid diagrams
- ❌ Build errors

### Important (should fix)
- ⚠️ Missing frontmatter (title, description)
- ⚠️ Inconsistent terminology
- ⚠️ Confusing examples
- ⚠️ Missing screenshots (for UI sections)

### Nice to have (can wait)
- 💡 More examples
- 💡 Better diagrams
- 💡 Deeper explanations

## Quick Fixes

### Broken link
```markdown
<!-- Bad -->
[Link](wrong-path.md)

<!-- Good -->
[Link](../correct/path.md)
```

### Invalid JSON
```bash
# Validate JSON
cat file.md | grep -A 10 '```json' | jq
```

### Missing frontmatter
```markdown
---
title: Page Title
description: Brief description
keywords: [key, words]
---
```

## Pass/Fail Criteria

**PASS if:**
- ✅ `mkdocs build --strict` succeeds
- ✅ All pages load in preview
- ✅ No console errors in browser
- ✅ Navigation works
- ✅ Search works

**FAIL if:**
- ❌ Build errors
- ❌ Broken links
- ❌ Pages don't load
- ❌ Mermaid diagrams broken
- ❌ Invalid JSON examples

## Time Budget

| Task | Time | Priority |
|------|------|----------|
| Automated check | 2 min | Must do |
| Local preview | 5 min | Must do |
| Key pages | 5 min | Must do |
| Mobile check | 2 min | Should do |
| Link check | 1 min | Must do |
| **Total** | **15 min** | |

## After Review

### If PASS
```bash
# Ready to deploy
mkdocs gh-deploy
```

### If FAIL
1. Fix critical issues
2. Re-run validation
3. Review again
4. Then deploy

## One-Liner Review

```bash
cd docs-site && \
./scripts/validate-docs.sh && \
mkdocs serve
# Then click around for 5 minutes
```

---

**Start here:** `./scripts/validate-docs.sh`
