---
name: nexus-doctor
description: Run Nexus AI diagnostics. Checks Local running, addon active, MCP server, gateway, AI provider, API key, and site count. Auto-suggests the exact fix command for every failure. Use when troubleshooting Nexus or verifying a working setup.
allowed-tools: Bash(nexus *)
---

# Nexus AI Diagnostic

Current system status:

```!
nexus doctor
```

Based on the output above:

1. **Triage**: Separate ✅ passing, ⚠️ warnings, ❌ failures
2. **For each failure**: Explain what it means and provide the exact fix command in a copyable code block
3. **For each warning**: Explain when it becomes a problem and how to resolve it
4. **Overall verdict**: Is Nexus fully operational? If not, what's the critical path to fix it?

If everything is green, confirm the setup is healthy and suggest what to try next.
