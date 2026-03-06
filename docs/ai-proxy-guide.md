# AI Proxy Server Guide

The Nexus AI addon for Local includes a standalone HTTP server that provides an OpenAI-compatible API backed by local Ollama. It is designed for enhanced clients that need tool injection or agentic workflows — the bundled `ai-provider-for-ollama` WordPress plugin already talks directly to Ollama at `localhost:11434`, so standard WordPress AI features do not need the proxy.

## How It Works

- Binds to `127.0.0.1` only (not network-accessible)
- Port is auto-assigned; auth token is auto-generated
- No Docker is involved — Local runs WordPress sites natively

Find the port and auth token in the Local addon preferences panel.

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

The token is displayed in the Nexus AI addon preferences within Local.

## Rate Limits

- 60 requests per minute (token bucket)
- 1 MB maximum request body size

## Endpoints

### `GET /health`

Returns proxy status.

```bash
curl http://127.0.0.1:<port>/health \
  -H "Authorization: Bearer <token>"
```

### `GET /v1/models`

Lists available Ollama models in OpenAI format. Each model entry includes a `toolCapable` flag indicating whether it supports tool/function calling.

```bash
curl http://127.0.0.1:<port>/v1/models \
  -H "Authorization: Bearer <token>"
```

### `POST /v1/chat/completions`

Chat completions endpoint. Supports streaming via SSE (`"stream": true`).

```bash
curl http://127.0.0.1:<port>/v1/chat/completions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### `POST /v1/embeddings`

Generates embeddings using a bundled ONNX model (all-MiniLM-L6-v2, 384 dimensions). Does not require Ollama.

```bash
curl http://127.0.0.1:<port>/v1/embeddings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding",
    "input": "Some text to embed"
  }'
```

## Tool Modes

Set the tool mode with the `X-Nexus-Tools` header on chat completion requests.

| Mode | Header Value | Behavior |
|------|-------------|----------|
| **Passthrough** | `passthrough` (default) | Forwards tools from the request to Ollama as-is. Translates `tool_calls` arguments from Ollama objects to OpenAI JSON strings. |
| **Inject** | `inject` | Merges MCP tools (fleet health, search, site management) with request tools, capped at 20 total. |
| **Agentic** | `agentic` | Executes MCP tool calls server-side (up to 5 rounds). Returns WordPress tool calls to the caller without execution. |

Example with tool injection:

```bash
curl http://127.0.0.1:<port>/v1/chat/completions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "X-Nexus-Tools: inject" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "Show me fleet health"}]
  }'
```

## Model Recommendations

| RAM | Recommended Models |
|-----|-------------------|
| 8 GB | `llama3.2:3b`, `phi3:mini` |
| 16 GB | `llama3.1:8b`, `mistral:7b`, `qwen2.5:7b` |
| 32 GB+ | `llama3.1:70b` (quantized) |

**Tool-capable models:** `llama3.1`, `mistral`, `qwen2.5`. Check the `toolCapable` flag in the `/v1/models` response to confirm support.

Pull a model before using it:

```bash
ollama pull llama3.1:8b
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Proxy returns 503 | Ollama is not running | Start Ollama (`ollama serve`) |
| Model not found | Model not pulled | Run `ollama pull <model>` |
| Tool calls not working | Model lacks tool support | Use a tool-capable model; check the `toolCapable` flag |
| Connection refused | Local not running or addon not loaded | Start Local and ensure the Nexus AI addon is loaded |
