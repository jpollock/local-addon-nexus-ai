# Documentation Review Guide

Quick guide to reviewing the Nexus AI documentation.

## 1. Build and Preview Locally

The best way to review is to see the actual rendered site:

```bash
cd docs-site

# Install dependencies (first time only)
pip install -r requirements.txt

# Serve locally with live reload
mkdocs serve
```

Then open: **http://127.0.0.1:8000**

Changes auto-reload as you edit files.

## 2. Build Check (Strict Mode)

Verify there are no broken links or errors:

```bash
# Build in strict mode (fails on warnings)
mkdocs build --strict

# If successful, you'll see:
# INFO - Documentation built in X.XX seconds
```

Common errors:
- Broken internal links
- Missing images
- Invalid markdown
- Broken Mermaid diagrams

## 3. Quick Review Checklist

### Navigation
- [ ] All pages accessible from nav
- [ ] Breadcrumbs work correctly
- [ ] Table of contents on right side
- [ ] Back to top button works

### Content
- [ ] All Mermaid diagrams render
- [ ] Code blocks have syntax highlighting
- [ ] Tables are readable
- [ ] Admonitions (info/warning/tip) display correctly
- [ ] Internal links work (click to verify)
- [ ] Examples are accurate

### Search
- [ ] Search bar appears
- [ ] Search returns relevant results
- [ ] Try: "installation", "CLI", "MCP", "scan"

### Mobile
- [ ] Open in narrow browser window
- [ ] Menu collapses to hamburger
- [ ] Content is readable
- [ ] Code blocks scroll horizontally

## 4. Page-by-Page Review

### Priority Pages (Review First)

1. **Home** (`index.md`)
   - Clear value proposition?
   - Architecture diagram renders?
   - Quick start links work?

2. **CLI Quick Start** (`getting-started/cli-quick-start.md`)
   - Installation instructions clear?
   - All commands work?
   - Code examples correct?

3. **UI Quick Start** (`getting-started/ui-quick-start.md`)
   - Screenshots present (we don't have these yet)?
   - Steps make sense?

4. **CLI Command Reference** (`reference/cli-command-reference.md`)
   - All commands documented?
   - Examples accurate?
   - Exit codes correct?

5. **Claude Desktop Integration** (`integrations/claude-desktop.md`)
   - Config examples valid JSON?
   - Troubleshooting helpful?

### Check Each Page For

- [ ] **Frontmatter** - title, description, keywords present
- [ ] **First paragraph** - Clear summary of what page covers
- [ ] **Code examples** - Syntax highlighted, copy button works
- [ ] **Mermaid diagrams** - Render correctly, readable
- [ ] **Links** - Internal links work, external links valid
- [ ] **Next steps** - Links to related pages at bottom

## 5. Automated Checks

Create a simple link checker:

```bash
# Check for broken internal links
cd docs-site
grep -r "]\(" docs/ | grep -v "http" | while read line; do
  echo "Checking: $line"
done

# Or use mkdocs built-in strict mode
mkdocs build --strict 2>&1 | grep -i "error\|warning"
```

## 6. Content Accuracy Review

Check technical accuracy:

### Installation Commands
```bash
# Try the actual commands from docs
npm install -g @local-labs-jpollock/local-addon-nexus-ai
nexus --version
nexus list
```

### Config Files
- [ ] JSON syntax valid (use `jq` to validate)
- [ ] File paths correct for macOS/Windows/Linux
- [ ] Environment variables exist

### Code Examples
- [ ] TypeScript/JavaScript syntax correct
- [ ] Python syntax correct (if any)
- [ ] Bash scripts executable

## 7. Visual Review

### Layout
- [ ] Pages don't have excessive whitespace
- [ ] Tables fit on screen
- [ ] Code blocks don't overflow unnecessarily
- [ ] Lists are properly formatted

### Typography
- [ ] Headings hierarchy makes sense (H1 → H2 → H3)
- [ ] No orphaned headings
- [ ] Bold/italic used consistently
- [ ] Code blocks vs inline code used correctly

### Diagrams
For each Mermaid diagram:
- [ ] Renders without errors
- [ ] Labels are readable
- [ ] Flow makes sense
- [ ] Not too wide (fits on screen)

## 8. User Journey Testing

Try following the docs as a new user:

### Journey 1: CLI User
1. Start at homepage
2. Click "CLI Quick Start"
3. Follow installation steps
4. Follow first scan steps
5. Follow first AI query steps

**Questions:**
- Can you complete without getting stuck?
- Are prerequisites clear?
- Do commands work as written?

### Journey 2: UI User
1. Start at homepage
2. Click "UI Quick Start"
3. Follow installation steps
4. Try using the features described

**Questions:**
- Is it clear how to install?
- Are UI elements described accurately?
- Can you find your way around?

### Journey 3: Claude Desktop User
1. Navigate to "Claude Desktop Integration"
2. Follow setup instructions
3. Try the examples

**Questions:**
- Is config file location clear?
- Are JSON examples valid?
- Is troubleshooting helpful?

## 9. Cross-Reference Check

Verify internal consistency:

### Version Numbers
- [ ] All version numbers match
- [ ] Package names consistent
- [ ] URLs use same repo (jpollock/local-addon-nexus-ai)

### Terminology
- [ ] "Nexus AI" vs "nexus" used consistently
- [ ] "Site" vs "Install" vs "Environment" clear
- [ ] "CLI" vs "MCP Server" distinction clear

### Examples
- [ ] Site names consistent (mysite, blog, shop)
- [ ] User names consistent
- [ ] Domain names consistent

## 10. Placeholder Check

Find pages that still need work:

```bash
cd docs-site/docs
grep -r "Work in Progress" .
grep -r "TODO:" .
```

**Current status:**
- ~10 pages complete (detailed content)
- ~80 pages placeholder (need content)

## 11. GitHub Pages Preview (Optional)

Before deploying to main site:

```bash
# Build static site
mkdocs build

# Check output in site/ directory
ls -la site/

# Optionally serve from site/ directory
cd site
python3 -m http.server 8080
# Open http://localhost:8080
```

## 12. Comparison to Reference

Compare our docs to similar projects:

- [Local CLI docs](https://github.com/jpollock/local-addon-cli/blob/main/docs/CLI-USAGE.md) - Is our style similar?
- [MkDocs Material examples](https://squidfunk.github.io/mkdocs-material/reference/) - Are we using features correctly?

## Quick Review Commands

```bash
# Full check
cd docs-site
mkdocs build --strict && echo "✓ Build successful"

# Serve and review
mkdocs serve

# Count completed vs placeholder pages
echo "Complete pages:"
find docs -name "*.md" -type f | xargs grep -L "Work in Progress" | wc -l
echo "Placeholder pages:"
find docs -name "*.md" -type f | xargs grep -l "Work in Progress" | wc -l

# Find broken internal links (rough check)
mkdocs build --strict 2>&1 | grep -i "warning.*could not find"
```

## Review Priority

If you have limited time, review in this order:

1. **Critical** (30 min)
   - Homepage
   - CLI Quick Start
   - MCP Setup
   - Build check (`mkdocs build --strict`)

2. **Important** (1 hour)
   - All Getting Started pages
   - CLI Command Reference
   - Claude Desktop Integration

3. **Nice to Have** (2 hours)
   - Architecture pages
   - Feature deep dives
   - All code examples work

## Feedback Template

When reviewing, note:

```markdown
## Page: [page name]

### Issues
- [ ] Broken link: [description]
- [ ] Unclear: [section]
- [ ] Missing: [content]
- [ ] Error: [what's wrong]

### Suggestions
- Add example for [feature]
- Clarify [concept]
- Add diagram for [flow]

### Questions
- Is [assumption] correct?
- Should we include [topic]?
```

## Next Steps After Review

Based on review findings:

1. **Fix critical issues** - Broken links, invalid JSON, wrong commands
2. **Improve clarity** - Rewrite confusing sections
3. **Add missing content** - Fill in gaps
4. **Deploy** - Push to GitHub Pages
5. **Iterate** - Gather user feedback, improve

---

**Start here:**

```bash
cd docs-site
mkdocs serve
# Open http://127.0.0.1:8000 and click around
```
