# Testing Strategy — Nexus AI

## 4-Tier Test Pyramid

| Tier | Directory | Command | What it tests | Speed |
|------|-----------|---------|---------------|-------|
| Unit | `tests/main/` | `npm test` | Code logic with mocked dependencies | ~10s |
| Eval | `tests/eval/` | `npm run test:eval` | Content quality + LLM behavior | Variable |
| Integration | `tests/integration/` | `npm run test:integration` | Real ONNX, LanceDB, MCP | ~60s |
| E2E | `tests/e2e/` | `npm run test:e2e` | Real Local app over MCP HTTP | ~5-10min |

Run everything: `npm run test:all`

---

## Unit Tests (`tests/main/`)

Standard Jest tests with all dependencies mocked. Fast and deterministic.

**What belongs here:**
- Provider configuration validation
- Tool adapter logic
- Safety tier assignments
- Service class behavior with mocked deps
- Type/schema correctness

**Key principle:** If it never calls an LLM or external service, it's a unit test.

**Example:** `chat-quality.test.ts` — validates provider configs, tool adapter
behavior, safety tiers. Zero LLM calls.

---

## Eval Tests (`tests/eval/`)

Two categories live here:

### Deterministic Evals (no LLM)
Tests that validate content quality without calling any model.

- `instructions-quality.test.ts` — server instruction structure and coverage
- `resource-quality.test.ts` — resource markdown quality

### LLM Evals (require Ollama)
Tests that call Ollama directly to verify model behavior given our system prompt
and tool definitions. These skip automatically when Ollama is not available.

- `chat-evals.test.ts` — tool routing, anti-hallucination, off-topic handling

**Key principle:** Unit tests verify code. Evals verify the AI. A unit test with
a mock provider cannot catch hallucination — only a test that calls the actual
model can verify it routes to the correct tool instead of making up data.

**Architecture for LLM evals:**
- Direct HTTP to `http://localhost:11434/api/chat` (not through ChatService)
- `stream: false`, `temperature: 0` for reproducibility
- Focused tool list (5-6 tools, not all 48) to reduce context pressure
- Auto-detect best tool-capable model
- Skip if Ollama not running or no model available

**Timeout:** 180s (LLM responses can be slow on local hardware)

---

## Integration Tests (`tests/integration/`)

Tests with real dependencies — ONNX runtime, LanceDB, MySQL connections.

**What belongs here:**
- Embedding generation with real ONNX model
- Vector store operations with real LanceDB
- Content pipeline end-to-end with real parsing

**Prerequisite:** `npm run download-model` (downloads ONNX model)

---

## E2E Tests (`tests/e2e/`)

Full system tests against a running Local instance with the Nexus AI addon loaded.
Communicates via MCP HTTP protocol.

**What belongs here:**
- MCP connectivity and protocol validation
- Tool execution through the real addon
- Site lifecycle operations
- Cross-system validation (chat prerequisites, WPE integration)

**Architecture:**
- `setup.ts` / `teardown.ts` manage Local app lifecycle
- `helpers/client.ts` — thin MCP HTTP client
- `helpers/environment.ts` — discovers sites, Ollama, CAPI availability
- Tests numbered `01-` through `14-` and run sequentially
- Conditional tests skip when dependencies unavailable (Ollama, CAPI, WPE)

---

## When to Write What

| Scenario | Test tier |
|----------|-----------|
| New tool schema validation | Unit |
| Provider config correctness | Unit |
| Tool adapter strips fields correctly | Unit |
| System prompt contains required phrases | Eval (deterministic) |
| Model routes "list my sites" to `local_list_sites` | Eval (LLM) |
| Model doesn't fabricate site names | Eval (LLM) |
| `local_list_sites` returns real data from running Local | E2E |
| Chat tool dependencies are available via MCP | E2E |
| Embedding generates correct dimensions | Integration |

---

## File Naming

- `*.test.ts` — all test files
- `*.e2e.test.ts` — E2E tests (in `tests/e2e/` with numbered prefix)
- No `.spec.ts` convention in this project

## Conditional Skipping

Tests that depend on external services should skip gracefully:
- Ollama tests: check `ollamaAvailable` from environment discovery
- WPE/CAPI tests: check `capiAvailable`
- Use early `return` (not `test.skip`) so the test shows as passed, not skipped
