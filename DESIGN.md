# DESIGN.md — Roadmap Copilot Agent Platform

## 1. Harness Diagram

```
POST /ai/roadmap-copilot/run
        │
        ▼
┌─────────────────────────┐
│   roadmapController     │  Validate RunRequest (Zod)
│   (src/api/)            │  Build AgentState
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      reactLoop          │  Max N steps (default 8)
│      (src/agent/)       │◄─────────────────────────┐
└────────┬────────────────┘                          │
         │ per step                                   │
         ▼                                           │
┌─────────────────────────┐                          │
│    contextManager       │  Score history           │
│    (src/context/)       │  Evict noise             │
│                         │  Compact large results   │
│    relevanceScorer      │  Emit ContextTrace       │
│    tokenEstimator       │                          │
└────────┬────────────────┘                          │
         │                                           │
         ▼                                           │
┌─────────────────────────┐                          │
│    LLM Provider         │  Anthropic / OpenAI      │
│    (src/llm/)           │  tool_choice: auto       │
│    provider interface   │                          │
└────────┬────────────────┘                          │
         │ tool_call                                  │
         ▼                                           │
┌─────────────────────────┐                          │
│    guardrail            │  Block confirmed=false   │
│    (src/guardrails/)    │  ToolError → model retries│
└────────┬────────────────┘                          │
         │                                           │
         ▼                                           │
┌─────────────────────────┐                          │
│    toolExecutor         │  registry lookup         │
│    (src/tools/)         │  execute → ToolResult    │
│                         │  log AgentStep           │
└────────┬────────────────┘                          │
         │                                           │
         ├─── tool_name != finish ──────────────────►┘
         │
         └─── finish ──────────────────────────────►
                                                     │
                                              ┌──────▼──────────────┐
                                              │ Validate RunResponse │
                                              │ (Zod)               │
                                              └──────┬──────────────┘
                                                     │
                                              Return JSON
```

---

## 2. Context Prioritization Policy

Every step, before the LLM call, the context manager assembles a message list that fits inside `token_budget_per_model_call`.

### Budget allocation

| Slot | Reserved tokens | Rationale |
|------|----------------|-----------|
| System prompt | 300 | Fixed overhead |
| Tool result / model reply space | 600 | Ensure model can respond |
| History + in-run results | `budget - 900` | Dynamic |

### History selection

History messages are **scored 0–1** by `relevanceScorer`:

- **−0.4** for noise patterns: `transfer learning`, `on-campus housing`, `imagenet weights`, etc.
- **+0.2** for topical patterns: `roadmap`, `month N`, `mlops`, `save`, `add`, `update`
- **+0.1 per shared keyword** with the current user message
- **−0.05** for assistant turns (slight recency discount)

Messages are ranked, then greedily included until budget is exhausted. **Evictions are logged** with reason and token count in `context_trace`.

### Roadmap compaction

After `get_roadmap`, the full JSON (~600 tokens) is **compacted** to a one-line summary format: `Roadmap slug: M1: title [act1, act2] | M2: ...`. This fires whenever the stored result exceeds 500 estimated tokens. Compaction decision is recorded in `context_decisions`.

### In-run tool results

Only the **last 2 tool results** are included verbatim (except when compaction applies). Older results are dropped silently to keep the window stable.

---

## 3. Guardrail Design

The `update_roadmap_month` tool includes a **confirm-before-write guardrail**:

```
confirmed === true   →  proceed
confirmed !== true   →  throw ToolError("confirmed must be true…", retryable=true)
```

The ToolError bubbles up through `executor.ts` and is returned as a `tool_result` with `success: false`. The model sees the error message and must retry with `confirmed: true` if the user has asked to save.

Why not a middleware layer? The tool itself is the safest place. It cannot be bypassed even if a new code path calls the tool directly. The `validateWrite` function in `guardrails/confirmBeforeWrite.ts` is extracted separately so it can be unit-tested independently.

---

## 4. Failure Modes and Handling

| Failure | Detection | Response |
|---------|-----------|----------|
| Invalid request body | Zod parse error | 400 with `details` array |
| LLM timeout (>30s) | `Promise.race` | Retry → fallback rules engine |
| LLM returns no tool call | `tool_call === null` | Retry with strict prompt once |
| Retry still no tool call | Second check | `generateFallbackResponse` (deterministic) |
| Unknown tool name | `getTool` returns undefined | `ToolResult { success: false }`, model retries |
| `update_roadmap_month` without confirm | ToolError | Model sees error, retries with `confirmed: true` |
| Max steps exceeded | `i >= maxSteps` | Fallback rules engine |
| Run timeout (>90s) | Date check in loop | Truncate, return fallback |
| Response schema invalid | Zod parse on output | 500 with validation details |

### Fallback rules engine

When AI path fails after retry, `rulesEngine.generateFallbackResponse` applies deterministic rules:
1. Parse user intent via regex (`add|update|mlops|month \d`)
2. If roadmap is in state, apply the update directly
3. Return a `[Fallback]`-tagged message

Documented in README.

---

## 5. What I Would NOT Do

**No LangChain / LlamaIndex / CrewAI.** These frameworks add indirection, opaque retry logic, and version churn. The assignment is to show understanding of the underlying mechanics — a `for` loop calling an LLM is clearer and more debuggable than a graph abstraction.

**No silent truncation.** Every eviction is logged in `context_trace`. Silent truncation produces agent runs that are impossible to replay or debug.

**No "fire and forget" writes.** The confirm-before-write guardrail is in the tool, not in a pre-flight check on the controller. Centralizing it at the tool level means it applies regardless of how the tool is invoked.

**No storing secrets in repo.** All provider credentials are environment variables only. `.env.example` documents the shape without values.

**No over-engineering the queue.** The async bonus uses BullMQ with a clean in-memory fallback when Redis is unavailable. For a take-home this is sufficient; in production you'd add DLQ monitoring, job archival, and replay utilities.

**No frontend.** The assignment explicitly excludes it. The check script and committed `examples/response.json` are the demonstration layer.
