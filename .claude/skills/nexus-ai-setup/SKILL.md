---
name: nexus-ai-setup
description: Set up AI features on a local WordPress site — installs the AI plugin, configures the provider, syncs credentials, and enables experiments. Use when onboarding a new local site for AI capabilities.
argument-hint: <site-name> [provider]
allowed-tools: Bash(nexus *)
---

# Nexus AI Setup for a Site

Site: `$0`
Provider: `$1` (optional — defaults to global preference)

## Step 1: Current state

```!
nexus sites list
nexus doctor
```

## Step 2: Validate prerequisites

1. Confirm `$0` exists and is running
2. Check the doctor output — gateway must be active for gateway mode
3. If no provider specified in `$1`, use the globally configured provider

## Step 3: Set up AI

```
nexus ai setup --site $0
```

If a specific provider was requested: `nexus ai setup --site $0 --provider $1`

Valid providers: `anthropic`, `openai`, `google`, `ollama`, `local-gateway`

## Step 4: Verify

After setup completes, confirm everything is working:

```
nexus ai status --site $0
```

Expected output shows:
- ✅ AI plugin active
- ✅ Provider configured
- ✅ Credentials synced
- ✅ Gateway active (if using gateway mode)

If anything is ❌, show the exact fix and offer to run it.
