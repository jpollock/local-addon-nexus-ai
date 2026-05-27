---
title: AI Model Catalog
description: Available AI models by provider and their defaults in Nexus AI v0.4.0
keywords: [models, gemini, claude, openai, ollama, AI provider, configuration]
---

# AI Model Catalog

Nexus AI supports four cloud providers and one local provider. Each provider has a default model that's used when no model is explicitly configured. Configure in **Preferences → AI Provider**.

---

## Provider Defaults (v0.4.0)

| Provider | Default Model | Notes |
|---|---|---|
| **Anthropic** | `claude-haiku-4-5-20251001` | Fast, cost-effective for fleet queries |
| **OpenAI** | `gpt-4o-mini` | Balanced capability/cost |
| **Google** | `gemini-2.5-flash` | Best default for Gemini — fast, multimodal |
| **Ollama** | `llama3.2` | Local inference, no API key required |
| **Local Gateway** | Inherits global provider | Credential proxy for WordPress sites |

---

## Google (Gemini) Models

Available models as of May 2026:

| Model | Best for |
|---|---|
| `gemini-2.5-pro` | Complex reasoning, long context |
| `gemini-2.5-flash` | **Default** — fast, balanced |
| `gemini-2.5-flash-lite` | Highest throughput, lowest cost |
| `gemini-3.5-flash` | Next-gen speed |
| `gemini-3.1-flash-lite` | Lightweight tasks |

The full list is fetched live from the Google API when you configure the provider — what you see in Preferences reflects what's actually available on your account.

**Note:** Nexus AI automatically strips JSON Schema keywords that Gemini doesn't support (`additionalProperties`, `$ref`, `allOf`, etc.) when sending tool definitions. You don't need to worry about this.

---

## Anthropic (Claude) Models

| Model | Notes |
|---|---|
| `claude-haiku-4-5-20251001` | **Default** — fastest, cheapest |
| `claude-sonnet-4-6` | Balanced capability |
| `claude-opus-4-7` | Most capable |

---

## OpenAI Models

| Model | Notes |
|---|---|
| `gpt-4o-mini` | **Default** — fast, affordable |
| `gpt-4o` | Full capability |
| `o3` | Reasoning tasks |
| `o4-mini` | Fast reasoning |

**Removed in v0.4.0:** `o1`, `o1-mini`, `o3-mini` (retired by OpenAI), `dall-e-2`, `dall-e-3` (image-only, not applicable to text chat).

---

## Retired Models

If your settings contain a retired model ID, Nexus AI automatically falls back to the provider default. Retired model IDs (as of v0.4.0):

```
gemini-3-pro-preview, gemini-3-flash-preview
gemini-2.0-flash, gemini-2.0-flash-lite
gemini-1.5-pro, gemini-1.5-flash, gemini-1.5-flash-8b
claude-sonnet-4-20250514, claude-opus-4-20250514
o1, o1-mini, o3-mini
dall-e-2, dall-e-3
```

---

## Ollama (Local Inference)

Ollama runs models locally — no API key, no cloud, no cost per request.

1. Install Ollama: `brew install ollama` or https://ollama.com
2. Pull a model: `ollama pull llama3.2`
3. Set provider to Ollama in Preferences

Nexus AI injects site context automatically, so Ollama responses are grounded in your actual site data.

---

## Local AI Gateway

When **Local AI Gateway** is enabled in Preferences, Nexus AI acts as a credential proxy:

- WordPress sites talk to the gateway, not directly to the cloud provider
- API keys are stored once in Local, never in each site's `wp_options`
- Usage and cost are tracked per-site in the Operations tab dashboard

The gateway supports Anthropic, OpenAI, and Google providers.
