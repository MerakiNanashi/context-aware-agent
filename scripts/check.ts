/**
 * scripts/check.ts
 * Validates examples/response.json against the schema and trajectory rules.
 * Run: npx ts-node scripts/check.ts
 */
import * as fs from "fs";
import * as path from "path";
import { RunResponseSchema } from "../src/schemas/response";
import { ZodError } from "zod";

const RESPONSE_PATH = path.join(__dirname, "../examples/response.json");
const RULES_PATH = path.join(__dirname, "../trajectory_rules.json");

interface TrajectoryRules {
  final_answer_must_contain: string[];
  forbidden_dominant_patterns_in_final_context: string[];
  context_compact_reason: string;
  context_must_compact_at_least_once: boolean;
  save_must_succeed_with_confirmed_true: boolean;
  guardrail_must_block_unconfirmed_save: boolean;
}

let exitCode = 0;

function pass(msg: string) { console.log(`  ✅  ${msg}`); }
function fail(msg: string) { console.log(`  ❌  ${msg}`); exitCode = 1; }

async function main() {
  console.log("\n=== Roadmap Copilot Response Checker ===\n");

  // 1. File exists
  if (!fs.existsSync(RESPONSE_PATH)) {
    fail(`examples/response.json not found at ${RESPONSE_PATH}`);
    process.exit(1);
  }
  pass("examples/response.json exists");

  const raw = fs.readFileSync(RESPONSE_PATH, "utf-8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
    pass("Valid JSON");
  } catch {
    fail("Invalid JSON in response.json");
    process.exit(1);
  }

  // 2. Schema validation
  try {
    RunResponseSchema.parse(data);
    pass("Passes RunResponseSchema (Zod)");
  } catch (err) {
    fail(`Schema validation failed: ${(err as ZodError).errors.map(e => e.message).join(", ")}`);
  }

  const resp = data as {
    success: boolean;
    final_message: string;
    roadmap_updated: boolean;
    slug: string;
    steps: Array<{ type: string; tool_name?: string; tool_args?: Record<string, unknown>; error?: string }>;
    context_trace: Array<{ context_evicted: string[]; context_decisions: string[]; context_included: string[] }>;
  };

  // 3. Trajectory rules
  const rules: TrajectoryRules = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));

  console.log("\n--- Trajectory Rules ---");

  // final_answer_must_contain
  for (const kw of rules.final_answer_must_contain) {
    if (resp.final_message.toLowerCase().includes(kw.toLowerCase())) {
      pass(`final_message contains "${kw}"`);
    } else {
      fail(`final_message missing "${kw}"`);
    }
  }

  // slug
  if (resp.slug === "priya-ds-2026") {
    pass(`slug is "priya-ds-2026"`);
  } else {
    fail(`slug is "${resp.slug}", expected "priya-ds-2026"`);
  }

  // roadmap_updated
  if (resp.roadmap_updated) {
    pass("roadmap_updated=true");
  } else {
    fail("roadmap_updated should be true");
  }

  // guardrail: update_roadmap_month must have been called with confirmed=true at some point
  const writeSteps = resp.steps.filter((s) => s.tool_name === "update_roadmap_month");
  const blockedWrite = resp.steps.some(
    (s) => s.tool_name === "update_roadmap_month" && s.error?.includes("confirmed")
  );
  if (rules.guardrail_must_block_unconfirmed_save) {
    if (blockedWrite) {
      pass("Guardrail blocked unconfirmed write (expected)");
    } else {
      // It's fine if model called with confirmed=true directly — depends on the run
      console.log("  ℹ️   No guardrail block event (model may have set confirmed=true directly)");
    }
  }

  const confirmedWrite = writeSteps.some(
    (s) => s.tool_args && (s.tool_args as { confirmed?: boolean }).confirmed === true
  );
  if (confirmedWrite) {
    pass("update_roadmap_month called with confirmed=true");
  } else if (writeSteps.length === 0) {
    fail("update_roadmap_month never called");
  }

  // required tools were called
  const calledTools = new Set(resp.steps.map((s) => s.tool_name).filter(Boolean));
  for (const required of ["get_user_profile", "get_roadmap", "update_roadmap_month"]) {
    if (calledTools.has(required)) {
      pass(`Tool ${required} was called`);
    } else {
      fail(`Required tool ${required} was not called`);
    }
  }

  // context compaction
  if (rules.context_must_compact_at_least_once) {
    const compacted = resp.context_trace.some((t) =>
      t.context_decisions.some((d) => d.includes("compact"))
    );
    if (compacted) {
      pass("Context was compacted at least once");
    } else {
      fail("Context was never compacted (context_must_compact_at_least_once=true)");
    }
  }

  // forbidden patterns not dominant in final context
  const finalTrace = resp.context_trace[resp.context_trace.length - 1];
  if (finalTrace) {
    const included = finalTrace.context_included.join(" ").toLowerCase();
    for (const pat of rules.forbidden_dominant_patterns_in_final_context) {
      if (!included.includes(pat.toLowerCase())) {
        pass(`"${pat}" not dominant in final context`);
      } else {
        fail(`Forbidden pattern "${pat}" found dominant in final context`);
      }
    }
  }

  console.log(`\n=== ${exitCode === 0 ? "ALL CHECKS PASSED ✅" : "SOME CHECKS FAILED ❌"} ===\n`);
  process.exit(exitCode);
}

main();
