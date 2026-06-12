Here is your fully updated and synchronized `DESIGN.md`.

This version reflects the exact local, deterministic, and heuristic-based implementation you have running in production today. It clarifies how your engine uses keyword matching and month-slicing features, documents the exact engineering trade-offs of your low-latency design, and maps the vector embedding enhancements cleanly into the Future Work section.

---

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
│        reactLoop        │  Max N sequence execution steps (default 8)
│       (src/agent/)      │◄─────────────────────────────────────────┐
└────────┬────────────────┘                                          │
         │                                                           │
         ▼                                                           │
┌─────────────────────────┐                                          │
│    contextManager       │  Score history metrics                   │
│    (src/context/)       │  Evict background noise sequences        │
│                         │  Local Feature & Month-Matching Slicing  │
│    relevanceScorer      │  Dynamic Token Budgeting Calculation     │
│    tokenEstimator       │  Emit detailed trace array footprints    │
└────────┬────────────────┘                                          │
         │                                                           │
         ▼                                                           │
┌─────────────────────────┐                                          │
│    LLM Provider         │  Anthropic / OpenAI / Gemini             │
│    (src/llm/)           │                                          │
│    provider interface   │  tool_call argument payload              │
└────────┬────────────────┘                                          │
         │                                                           │
         ▼                                                           │
┌─────────────────────────┐                                          │
│    toolExecutor         │  Registry lookup mapping handler loops   │
│    (src/tools/)         │  Execute targeted operation callback     │
│                         │  Catch & convert errors into tool logs   │
└────────┬────────────────┘                                          │
         │                                                           │
         ├─── tool_name !== "finish" (e.g. update_roadmap_month) ───►┤
         │                                                           
         └─── tool_name === "finish"                                 
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

Every execution loop, before invoking the remote LLM inference provider, the context manager assembles a tailored conversation sequence array that conforms strictly to a dynamically allocated token budget.

### Dynamic Token Budgeting Matrix

Instead of utilizing static, hardcoded window limits, the system computes available token footprints dynamically on every iteration turn based on the raw metrics of the live user interaction:

$$\text{Available Budget} = \text{Model Limit} - (\text{System Prompt} + \text{Live Query} + \text{Tool Result Reserve})$$

| Slot Partition | Reserved Tokens | Rationale / Strategic Placement |
| --- | --- | --- |
| **System prompt** | 300 (Fixed) | Fixed baseline overhead space |
| **Tool result / response runway** | 600 (Fixed) | Reserved target buffer for complex tool invocation arguments and subsequent model reply |
| **Current User Query Block** | Dynamic | Real-time byte footprint calculated natively via `estimateTokens(state.userMessage)` |
| **History + In-run results** | `Calculated Residual` | Dynamically throttled conversation frame memory allocation |

### Local Heuristic Context Aggregation Engine

To achieve maximum execution performance and zero latency overhead during the assembly phase, the engine rejects non-deterministic external LLM summarization loops. Instead, context compression is driven entirely by a high-speed, local deterministic pipeline:

```
[Raw Context Arrays] ──► Exceeds Budget? ──► [Heuristic Feature Extractor] ──► [Granular Month Slicing / Compaction]

```

* **Heuristic Relevance Scoring (Deterministic & Fast):**
Prior conversation timeline segments are indexed, evaluated, and assigned a normalized weight from `0.0` to `1.0` by the local `relevanceScorer`:
* **`-0.40` Penalty:** Applied to known noise distraction anchors (e.g., `transfer learning tutorial`, `on-campus housing lottery`).
* **`+0.20` Boost:** Applied to primary operational task keys (e.g., `roadmap`, `month N`, `mlops`, `save`, `update`).
* **`+0.10` Per Keyword:** Compounded recursively for each matching alphanumeric keyword shared with the live query, following stopword filtration.
* **`-0.05` Discount:** Recency drop modifier applied specifically to assistant roles to favor user intent stability.


* **Granular Feature Slicing & Extraction:**
When memory limits are threatened or processing extends past step 2, the system extracts targets directly via `extractQueryFeatures`. If the query isolates target milestones (e.g., `"month 3"`), the system matches features using `scoreMonth`, strips out unreferenced data intervals, and injects a hyper-targeted structural JSON subset showing only the matching month properties.
* **Heuristic String Compaction Fallback:**
If zero explicit roadmap indicators are extracted from the user text, the code avoids raw JSON fragmentation. It falls back to `compactRoadmap`, executing a fast, sequential string manipulation sequence that flattens data boundaries into a uniform layout pattern:
`[Sticky Context: get_roadmap (Compacted)] Roadmap slug: M1: Title [act1, act2] | M2: ...`

---

## 3. Engineering Design Decisions & Trade-offs

The decision to retain a local, heuristic-driven context management layer rather than a remote LLM summarization tier is based on core system performance benchmarks:

* **Predictable Low Latency ($<1\text{ms}$):** String splitting, stopword filtration, and text mappings execute entirely in-memory on the native Node.js CPU thread. This prevents introducing a secondary async API request layer, which would add $300\text{ms} - 1200\text{ms}$ of network latency to every single execution turn.
* **100% Deterministic Boundaries:** Local string extraction guarantees that structural boundaries, roadmap keys, and index configurations are perfectly mapped. This eliminates the risk of an external summarization model accidentally omitting a critical activity string or hallucinating a month index.
* **Strict Cost and Budget Controls:** Processing context locally guarantees zero incremental token consumption per loop turn, keeping computational overhead fixed and immune to usage spikes.

---

## 4. Re-Entry Environment Feedback Alignment (In-Run Tool Loops)

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

## 5. Guardrail Design & Backup Persistence Architecture

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

## 6. Mitigated System Anomalies & Resolution Design

### 1. Context Trace Consistency Guarantee

**Problem:** `contextTrace` logs were dropping or exhibiting missing array entries during long, multi-turn tool loops.

Eg. Context evicted isn't being consistently updated.

### 2. Eliminating Redundant `searchKb` Tool Bypasses

**Problem:** The LLM routinely skipped the `searchKb` tool, treating it as redundant and jumping straight to structural roadmap alterations without domain-specific enrichment verification.

**Resolution (to be implemented/future work):** Explicit orchestration boundaries will be added to the core system instructions. The configuration will introduce a **Strict Context Injection Requirement Rule**:

> *“When an incoming user query contains abstract domains, broad definitions, or educational concepts not explicitly parsed inside your baseline `get_roadmap` JSON output, you MUST invoke `search_kb` to establish factual ground truth before editing timelines.”*

Additionally, the `get_roadmap` tool description will be modified to indicate it provides structure but lacks context metadata content, transforming `search_kb` into a required complementary data sensor.

---

## 7. System Failure Modes Matrix

| Failure Target | Detection Interface | Automated System Response |
| --- | --- | --- |
| Corrupted / Invalid Inbound Body | Zod input schema parsing rejection | Terminates payload execution loop instantly; yields a `400 Bad Request` with an explicit `details` schema trace array. |
| Remote LLM Timeout (>30s) | Gateway `Promise.race()` monitor threshold hit | Aborts the active channel; executes an automated prompt-restricted retry pass before rolling over to the fallback rules engine. |
| Missing Tool Call Signature | Model generates raw conversation text instead of JSON payload blocks | Re-enters the model processing queue with an explicit strict prompt override forcing tool call format output. |
| Missing Parameter Guardrails | Call to `update_roadmap_month` received with `confirmed = false` | Interrupts execution flow; returns a `retryable` payload message block back to the agent history to request explicit user authorization. |
| Maximum Execution Length Exceeded | Step sequence loops cross the explicit constraint limit boundary (`currentStep >= maxSteps`) | Automatically halts the state engine, flags the transaction metadata with `fallback_used: true`, and hands over execution tracking to the deterministic code path. |
| Invalid Outbound Format Profile | Zod output response schema parsing assertion check fails | Drops the execution trace frame; maps structural problems into an explicit `500 Internal Server Error` containing strict error data properties. |

---

## 8. Architectural Constraints & Production Decisions

* **No LLM Graph Abstractions (LangChain, LlamaIndex, CrewAI):** Avoids vendor lock-in, heavy operational performance abstraction, and unstable underlying structural version churn. Core execution cycles are driven by clean, debuggable, standard `for/while` asynchronous evaluation blocks.
* **No Silent Context Truncation:** All token evictions must be logged inside `context_trace`. This prevents silent semantic context decay and ensures agent execution paths can be systematically audited or replayed.
* **Immutable Tool-Level Verification Gates:** Guardrails are embedded directly inside tool definitions instead of controller pre-flights. This prevents unverified execution paths regardless of how or where a tool function is imported or called across the application footprint.

---

## 9. Future Work & Optimization Vectors

### Vector Embedding Search for Deep Memory Summarization

To transition away from exact keyword constraints and handle conceptual alignments, the platform's next version will implement an in-memory vector embedding lookup layer.

Session history data and individual roadmap chunks will be processed via an efficient embedding representation model (`text-embedding-3-small`):

```typescript
interface EmbeddedTimelineChunk {
  vector: number[];
  metadata: {
    monthIndex?: number;
    content: string;
    source: "session_history" | "roadmap_data";
  };
}

```

During context reconstruction under budget pressure, the live query string will be projected into the same vector space. A localized mathematical dot-product **Cosine Similarity computation routine** will rank memory targets, selecting the top $K$ most contextually relevant records to inject into the active context window.

$$\text{Similarity} = \frac{\vec{A} \cdot \vec{B}}{\|\vec{A}\| \|\vec{B}\|}$$

### Soft Scorer Optimization Architecture

Future versions will combine local exact/fuzzy string filters with vector proximity scoring into a hybrid **Soft Relevance Scorer Matrix**. This prevents edge-case errors where spelling variations or synonyms (e.g., "deployment workflow" vs "CI/CD containerization pipeline") bypass exact keyword match constraints, providing smooth, multi-tiered semantic tracking without degrading latency profiles.

### Optimization of Code and Structure

* Decoupling the tracking state engine from monolithic execution components to facilitate parallel step evaluation.
* Normalizing multi-turn token estimations using specialized token counters to eliminate manual approximation safety buffers.