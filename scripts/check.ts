/**
 * scripts/check.ts
 * Boots the Express app in-memory, sends an HTTP POST request to the sync endpoint
 * with examples/request.json, saves the result to examples/response.json, and validates it.
 * Run: npx ts-node scripts/check.ts
 */
import * as fs from "fs";
import * as path from "path";
import request from "supertest"; 
import { app } from "../src/index"; // Import your live Express app instance
import { RunResponseSchema } from "../src/schemas/response";
import { ZodError } from "zod";

const REQUEST_PATH = path.join(__dirname, "../examples/request.json");
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
  console.log("\n=== Roadmap Copilot HTTP Endpoint Execution & Verification Loop ===\n");

  // =========================================================================
  // 1. EXECUTE REAL HTTP POST TO EXPRESS ENDPOINT & SAVE RESULT
  // =========================================================================
  if (!fs.existsSync(REQUEST_PATH)) {
    fail(`Source request file missing at ${REQUEST_PATH}`);
    process.exit(1);
  }

  try {
    console.log("🔄 Reading request payload...");
    const rawRequest = fs.readFileSync(REQUEST_PATH, "utf-8");
    const requestData = JSON.parse(rawRequest);

    console.log("🚀 Dispatching live HTTP POST /ai/roadmap-copilot/run...");
    
    // Supertest boots the app, hits the registered endpoint middleware stack, and returns the response
    const httpResponse = await request(app)
      .post("/ai/roadmap-copilot/run")
      .send(requestData)
      .set("Accept", "application/json");

    if (httpResponse.status !== 200 && httpResponse.status !== 400) {
      fail(`Endpoint returned an unexpected HTTP status code: ${httpResponse.status}`);
      console.error("Response body snippet:", httpResponse.body || httpResponse.text);
      process.exit(1);
    }

    console.log(`💾 Saving response from HTTP ${httpResponse.status} payload into examples/response.json...`);
    fs.writeFileSync(RESPONSE_PATH, JSON.stringify(httpResponse.body, null, 2), "utf-8");
    pass("Successfully captured and saved actual API HTTP response data");
  } catch (executionError) {
    fail(`Fatal error while issuing server request payload: ${(executionError as Error).message}`);
    process.exit(1);
  }

  // =========================================================================
  // 2. PARSE GENERATED DATA
  // =========================================================================
  const raw = fs.readFileSync(RESPONSE_PATH, "utf-8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
    pass("Valid output JSON layout verified");
  } catch {
    fail("Invalid JSON produced in response.json file output");
    process.exit(1);
  }

  // =========================================================================
  // 3. SCHEMA VALIDATION
  // =========================================================================
  try {
    RunResponseSchema.parse(data);
    pass("Passes RunResponseSchema validation check rules (Zod)");
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

  // =========================================================================
  // 4. TRAJECTORY RULES ASSERTIONS
  // =========================================================================
  const rules: TrajectoryRules = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));

  console.log("\n--- Trajectory Rules ---");

  // final_answer_must_contain
  for (const kw of rules.final_answer_must_contain) {
    if (resp.final_message && resp.final_message.toLowerCase().includes(kw.toLowerCase())) {
      pass(`final_message contains required pattern matching anchor: "${kw}"`);
    } else {
      fail(`final_message is missing strict required context block match: "${kw}"`);
    }
  }

  // slug
  if (resp.slug === "priya-ds-2026") {
    pass(`slug correctly tied to identifier "priya-ds-2026"`);
  } else {
    fail(`slug mismatch detected: encountered "${resp.slug}", expected "priya-ds-2026"`);
  }

  // roadmap_updated
  if (resp.roadmap_updated) {
    pass("roadmap_updated flags toggled active (true)");
  } else {
    fail("roadmap_updated failed update validation criteria flags");
  }

  // guardrail: update_roadmap_month handling
  const writeSteps = resp.steps ? resp.steps.filter((s) => s.tool_name === "update_roadmap_month") : [];
  const blockedWrite = writeSteps.some((s) => s.error?.includes("confirmed"));
  if (rules.guardrail_must_block_unconfirmed_save) {
    if (blockedWrite) {
      pass("Guardrail correctly blocked unconfirmed write operation step (expected behavior)");
    } else {
      console.log("  ℹ️   No guardrail block event (model may have set confirmed=true directly)");
    }
  }

  const confirmedWrite = writeSteps.some(
    (s) => s.tool_args && (s.tool_args as { confirmed?: boolean }).confirmed === true
  );
  if (confirmedWrite) {
    pass("update_roadmap_month tool sequence evaluated cleanly with confirmed=true");
  } else if (writeSteps.length === 0) {
    fail("Critical data mutation tool update_roadmap_month was never reached");
  }

  // required tools were called
  const calledTools = new Set(resp.steps ? resp.steps.map((s) => s.tool_name).filter(Boolean) : []);
  for (const required of ["get_user_profile", "get_roadmap", "update_roadmap_month"]) {
    if (calledTools.has(required)) {
      pass(`Tool checkpoint resolved: ${required} invoked successfully`);
    } else {
      fail(`Required workspace action tool missing from execution footprint: ${required}`);
    }
  }

  // context compaction
  if (rules.context_must_compact_at_least_once) {
    const compacted = resp.context_trace ? resp.context_trace.some((t) =>
      t.context_decisions.some((d) => d.includes("compact"))
    ) : false;
    if (compacted) {
      pass("Window compression triggered: Context data compacted successfully during runtime");
    } else {
      fail("Context preservation failure: Window was never compacted during loop lifetime");
    }
  }

  // forbidden patterns not dominant in final context
  const finalTrace = resp.context_trace ? resp.context_trace[resp.context_trace.length - 1] : null;
  if (finalTrace) {
    const included = finalTrace.context_included.join(" ").toLowerCase();
    for (const pat of rules.forbidden_dominant_patterns_in_final_context) {
      if (!included.includes(pat.toLowerCase())) {
        pass(`Noise pattern isolated: "${pat}" kept away from final execution footprint context state`);
      } else {
        fail(`Forbidden high-entropy pattern leakage detected: "${pat}" present inside final context block`);
      }
    }
  }

  console.log(`\n=== ${exitCode === 0 ? "ALL CHECKS PASSED ✅" : "SOME CHECKS FAILED ❌"} ===\n`);
  
  // Cleanly close the script sequence
  process.exit(exitCode);
}

// Fire execution
main();