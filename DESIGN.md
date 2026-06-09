# DESIGN.md — Roadmap Copilot Agent Platform

## 1. Harness Diagram


```

POST /ai/roadmap-copilot/run
│
▼
┌─────────────────────────┐
│   roadmapController     │  Validate RunRequest via Zod schema
│   (src/api/)            │  Build unified memory AgentState footprint
└────────────┬────────────┘
│
▼
┌─────────────────────────┐
│      reactLoop          │  Max N sequence execution steps (default 8)
│      (src/agent/)       │◄─────────────────────────────────────────┐
└────────┬────────────────┘                                          │
│ per iteration step                                        │
▼                                                           │
┌─────────────────────────┐                                          │
│    contextManager       │  Score history metrics                   │
│    (src/context/)       │  Evict background noise sequences        │
│                         │  Compact dense payloads (>500 tokens)    │
│    relevanceScorer      │  Emit detailed trace array footprints    │
│    tokenEstimator       │                                          │
└────────┬────────────────┘                                          │
│                                                           │
▼                                                           │
┌─────────────────────────┐                                          │
│    LLM Provider         │  Anthropic / OpenAI / Gemini             │
│    (src/llm/)           │  Enforce tool_choice: "auto" configuration│
│    provider interface   │                                          │
└────────┬────────────────┘                                          │
│ tool_call argument payload                                │
▼                                                           │
┌─────────────────────────┐                                          │
│    toolExecutor         │  Registry lookup mapping handler loops   │
│    (src/tools/)         │  Execute targeted operation callback     │
│                         │  Catch & convert errors into tool logs   │
└────────┬────────────────┘                                          │
│                                                           │
├─── tool_name !== "finish" (e.g. update_roadmap_month) ───►┤
│                                                           │
└─── tool_name === "finish" ────────────────────────────────┘
│
┌─────────────▼─────────────┐
│ Validate RunResponse(Zod) │
│ Verify Trajectory Anchors │
└─────────────┬─────────────┘
│
Return Strict JSON

```

---

## 2. Context Prioritization & Alignment Policy

Every execution loop, before invoking the remote LLM inference provider, the context manager assembles a tailored conversation sequence array that conforms strictly to `token_budget_per_model_call`.

### Budget Allocation Matrix

| Slot Partition | Reserved Tokens | Rationale / Strategic Placement |
|----------------|-----------------|---------------------------------|
| System prompt  | 300             | Fixed baseline overhead space   |
| Tool result / response runway | 600             | Reserved target buffer for complex tool invocation arguments |
| History + in-run results | `budget - 900`  | Dynamically calculated conversation frame footprint |

### History Selection & Relevance Scoring

Prior context dialogue items are explicitly evaluated and mapped to a normalized score range of **`0.0` to `1.0`** by the `relevanceScorer`:

* **`-0.40` Penalty:** Assigned to known noise distraction anchors (e.g., `transfer learning tutorial`, `on-campus housing lottery`, `imagenet weights`).
* **`+0.20` Boost:** Assigned to primary operational task keys (e.g., `roadmap`, `month N`, `mlops`, `save`, `add`, `update`).
* **`+0.10` Per Keyword:** Compounded recursively for each matching alphanumeric keyword shared with the current live incoming query.
* **`-0.05` Discount:** Recency drop modifier applied specifically to assistant roles to favor user context.

Messages are sequentially sorted by score weight and greedily consumed until the structural allocation frame is packed. **All evictions** are appended transparently to the context trace dictionary with explicit byte sizes and reasons for tracking audits.

### Roadmap Compaction Optimization

To prevent early window degradation, the active raw baseline JSON roadmap representation (~600 tokens) is intercepted and **compacted** into a one-line summary layout format once total string weight exceeds `500` tokens:  
`[Sticky Context: get_roadmap (Compacted)] Roadmap slug: M1: Title [act1, act2] | M2: ...`

This optimization triggers adaptively after step 2 once the core layout definition is mapped. Compaction records are logged under `context_decisions`.

### Re-Entry Environment Feedback Alignment (In-Run Tool Loops)

To prevent execution loop blind-spots where the LLM repeats actions indefinitely, the **last 2 adjacent execution steps** are mapped into the tracking context frame utilizing **`role: "user"`**. 

```typescript
// Environment context stitching pattern inside contextManager.ts
const trailingSteps = state.steps.filter((s) => s.tool_result !== undefined).slice(-2);
for (const s of trailingSteps) {
  processedStepMessages.push({
    role: "user", // Aligns tool execution outputs to appear as environmental state confirmations
    content: `[Step ${s.step} Result: ${s.tool_name}] ${JSON.stringify(s.tool_result)}`
  });
}

```

This guarantees that the model parses structural task success feedback (`{ updated: true }`) as a definitive ambient state transformation, instead of reading its own previous actions as text, guiding it cleanly toward the `finish` tool execution pathway.

---

## 3. Guardrail Design & Backup Persistence Architecture

The mutation-capable `update_roadmap_month` pipeline implements a strict multi-tier confirmation constraint framework:

```
[Inbound Parameter Verification Execution Check]
               │
               ▼
       Is confirmed === true? 
        ├── NO  ──► Throw ToolError("confirmed must be true...", retryable=true)
        └── YES ──► Check Structure ──► Persist In-Memory ──► Write External JSON Backup

```

1. **Confirmation Gate (Tier 1):** Omitted or `false` confirmation values cause a `ToolError` with `retryable: true` to bubble up. The inference agent intercepts this instruction text block and issues a self-correction pass requesting explicit user consent.
2. **Structural Sanitization (Tier 2):** Strict datatype enforcement blocks execution errors down-stream (e.g., verifying `month` is a pure primitive number and `activities_to_add` evaluates as an array allocation).
3. **Snapshot File Serialization (Tier 3):** Upon receiving a valid mutation query accompanied by `confirmed = true`, the system commits the core state changes in-memory via `persistRoadmap` and immediately logs a dedicated system state backup file to disk:
`examples/saved_roadmap_${slug}_m${month}.json`

This dual-layer mechanism keeps state manipulation atomic and satisfies trajectory rule verification metrics by ensuring compliance before `finish` is called.

---

## 4. Failure Modes and Resolution Strategy

| Failure Target | Detection Interface | Automated System Response |
| --- | --- | --- |
| Corrupted / Invalid Inbound Body | Zod input schema parsing rejection | Terminates payload execution loop instantly; yields a `400 Bad Request` with an explicit `details` schema trace array. |
| Remote LLM Timeout (>30s) | Gateway `Promise.race()` monitor threshold hit | Aborts the active channel; executes an automated prompt-restricted retry pass before rolling over to the fallback rules engine. |
| Missing Tool Call Signature | Model generates raw conversation text instead of JSON payload blocks | Re-enters the model processing queue with an explicit strict prompt override forcing tool call format output. |
| Missing Parameter Guardrails | Call to `update_roadmap_month` received with `confirmed = false` | Interrupts execution flow; returns a `retryable` payload message block back to the agent history to request explicit user authorization. |
| Maximum Execution Length Exceeded | Step sequence loops cross the explicit constraint limit boundary (`currentStep >= maxSteps`) | Automatically halts the state engine, flags the transaction metadata with `fallback_used: true`, and hands over execution tracking to the deterministic code path. |
| Invalid Outbound Format Profile | Zod output response schema parsing assertion check fails | Drops the execution trace frame; maps structural problems into an explicit `500 Internal Server Error` containing strict error data properties. |

### Deterministic Rule Recovery Engine

If the system reaches an unresolvable failure state or exhausts the retry budget, the execution framework drops processing back to `rulesEngine.generateFallbackResponse`. This engine matches intents deterministically using rigid pattern regex sequences:

1. Scans conversation logs for critical intent tokens via `/add|update|mlops|month \d/i`.
2. Intercepts any available runtime memory instances inside `ctx.state.roadmap` and updates target structures.
3. Generates a user-facing notification stamped with a standard `[Fallback]` warning header string prefix, ensuring `success: true` is safely maintained while setting the metadata tracking attribute to `fallback_used: true`.

---

## 5. Architectural Constraints & Production Decisions

* **No LLM Graph Abstractions (LangChain, LlamaIndex, CrewAI):** Avoids vendor lock-in, heavy operational performance abstraction, and unstable underlying structural version churn. Core execution cycles are driven by clean, debuggable, standard `for/while` asynchronous evaluation blocks.
* **No Silent Context Truncation:** All token evictions must be logged inside `context_trace`. This prevents silent semantic context decay and ensures agent execution paths can be systematically audited or replayed.
* **Immutable Tool-Level Verification Gates:** Guardrails are embedded directly inside tool definitions instead of controller pre-flights. This prevents unverified execution paths regardless of how or where a tool function is imported or called across the application footprint.
* **Strict Production Secret Hygiene:** The codebase excludes hardcoded keys. All authentication strings, URLs, and token hashes are managed through local environment files, with structural patterns documented in `.env.example`.
* **Resilient Queue Fallbacks:** The asynchronous job framework initializes standard `BullMQ` elements. If the server loses access to local or remote Redis server processes, the controller interceptor safely handles errors, falling back instantly to in-process execution loops via `setImmediate()` to ensure system availability.

