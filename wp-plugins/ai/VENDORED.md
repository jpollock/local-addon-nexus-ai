# Vendored WordPress AI Plugin

This is the official WordPress AI plugin, vendored into the local-addon-nexus-ai repository.

**Original Repository:** https://github.com/WordPress/ai.git
**Vendored From:** develop branch
**Commit:** e63b750 (Merge pull request #232)
**Version:** 0.2.1-329-ge63b750
**Vendored Date:** 2026-03-04

## Why Vendored?

This plugin is required for the Ollama AI provider to work with WordPress AI experiments.
It's vendored here to ensure version compatibility and to simplify deployment via the
local-addon-nexus-ai addon.

## Updating

To update to a newer version:
```bash
cd /tmp
git clone https://github.com/WordPress/ai.git wordpress-ai
cd wordpress-ai
git checkout develop
# Or specific tag: git checkout v0.2.2
rsync -av --exclude='.git' . /path/to/local-addon-nexus-ai/wp-plugins/ai/
```

Then update this file with the new commit and version information.
