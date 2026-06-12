import { AgentState, ReactLoopResult, ToolContext } from "./types";
import { buildContext } from "../context/contextManager";
import { LLMProvider } from "../llm/provider";
import { toolDefinitions } from "../tools/registry";
import { executeTool } from "../tools/executor";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { retryWithStrictPrompt } from "../fallback/retry";
import { generateFallbackResponse } from "../fallback/rulesEngine";
import { AgentStep } from "../schemas/response";
import { validateWrite } from "../guardrails/confirmBeforeWrite"

const LLM_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 90_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}

function getLLMProvider(state: AgentState): LLMProvider {
  const apiKey = process.env.LLM_API_KEY ?? "";
  if (state.provider === "openai") {
    const { OpenAIProvider } = require("../llm/openai");
    return new OpenAIProvider(apiKey) as LLMProvider;
  }
  else if (state.provider === "gemini") {
    const { GeminiProvider } = require("../llm/gemini");
    return new GeminiProvider(apiKey) as LLMProvider;
  }
  const { AnthropicProvider } = require("../llm/anthropic");
  return new AnthropicProvider(apiKey) as LLMProvider;
}

export async function runAgent(state: AgentState): Promise<ReactLoopResult> {
  const systemPrompt = buildSystemPrompt();
  const provider = getLLMProvider(state);
  const runDeadline = Date.now() + RUN_TIMEOUT_MS;

  for (let i = 0; i < state.maxSteps; i++) {
    state.currentStep = i + 1;

    if (Date.now() > runDeadline) {
      state.steps.push({
        step: state.currentStep,
        type: "error",
        error: "Run timeout exceeded",
      });
      break;
    }

    // --- Build context ---
    const { messages, trace } = buildContext(state, state.currentStep);
    state.contextTrace.push(trace);

    // =================================================================
    // 🔥 DEBUG: PRINT THE CONTEXT SENT TO THE LLM FOR THIS STEP
    // =================================================================
    logStepContext(state.currentStep, systemPrompt, messages);
    // =================================================================

    // --- Call LLM ---
    let llmResponse;
    try {
      llmResponse = await withTimeout(
        provider.generate(systemPrompt, messages, toolDefinitions, state.model, 1024),
        LLM_TIMEOUT_MS,
        "LLM call"
      );
    } catch (err) {
      // Timeout or network error → fallback
      state.steps.push({
        step: state.currentStep,
        type: "error",
        error: `LLM call failed: ${(err as Error).message}`,
      });
      state.fallbackUsed = true;
      return generateFallbackResponse(state);
    }

    state.tokenUsage.push({
      step: state.currentStep,
      input_tokens: llmResponse.input_tokens,
      output_tokens: llmResponse.output_tokens,
    });

    // If no tool call, retry once with strict prompt
    if (!llmResponse.tool_call) {
      state.retryCount++;
      try {
        llmResponse = await withTimeout(
          retryWithStrictPrompt(
            provider,
            systemPrompt,
            messages,
            toolDefinitions,
            state.model,
            "No tool call in response"
          ),
          LLM_TIMEOUT_MS,
          "LLM retry"
        );
      } catch {
        state.fallbackUsed = true;
        return generateFallbackResponse(state);
      }

      if (!llmResponse.tool_call) {
        state.fallbackUsed = true;
        return generateFallbackResponse(state);
      }
    }

    const { name: toolName, arguments: toolArgs } = llmResponse.tool_call!;

    // Log the tool call step
    const toolCallStep: AgentStep = {
      step: state.currentStep,
      type: "tool_call",
      tool_name: toolName,
      tool_args: toolArgs,
    };
    state.steps.push(toolCallStep);

    // call guardrail

    try{
      const mutatingTools = ["update_roadmap",];

      if (mutatingTools.includes(toolName)) {
        validateWrite(toolArgs, toolName);
      }

    } catch (guardrailError) {
      state.steps.push({
        step: state.currentStep,
        type: "error",
        tool_name: toolName,
        error: (guardrailError as Error).message,
        latency_ms: 0,
      });

    continue;
    }


    // --- Execute tool ---
    const ctx: ToolContext = {
      requestId: `req_${Date.now()}`,
      step: state.currentStep,
      state,
    };

    const t0 = Date.now();
    const result = await executeTool(toolName, toolArgs, ctx);
    const latency = Date.now() - t0;

    const resultStep: AgentStep = {
      step: state.currentStep,
      type: result.success ? "tool_result" : "error",
      tool_name: toolName,
      tool_result: result.result,
      error: result.error,
      latency_ms: latency,
    };
    state.steps.push(resultStep);

    // --- Check finish ---
    if (toolName === "finish" && result.success) {
      const finishResult = result.result as { done: boolean; message: string };
      return {
        finished: true,
        message: finishResult.message,
        roadmapUpdated: state.roadmapUpdated,
        slug: state.roadmap?.slug ?? state.profile?.roadmap_slug ?? "unknown",
        steps: state.steps,
        traces: state.contextTrace,
      };
    }
  }

  // Max steps reached without finish
  state.fallbackUsed = true;
  return generateFallbackResponse(state);
}

/**
 * Helper function to print beautifully formatted step contexts
 */
function logStepContext(step: number, systemPrompt: string, messages: any[]) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📡 [STEP ${step}] LLM INVOCATION CONTEXT DUMP`);
  console.log(`${"=".repeat(60)}`);

  console.log(`\n⚙️  --- [SYSTEM PROMPT] ---`);
  console.log(systemPrompt);

  console.log(`\n💬 --- [CONVERSATION HISTORY / MESSAGES] ---`);
  messages.forEach((msg: any, idx: number) => {
    const roleColor = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '🛠️';
    console.log(`\n   [Message ${idx + 1}] ${roleColor} Role: ${msg.role.toUpperCase()}`);
    console.log(`   ${"-".repeat(40)}`);
    
    if (typeof msg.content === 'string') {
      console.log(msg.content.split('\n').map((line: string) => `   ${line}`).join('\n'));
    } else {
      console.log(JSON.stringify(msg.content, null, 2).split('\n').map((line: string) => `   ${line}`).join('\n'));
    }
  });

  console.log(`\n${"=".repeat(60)}\n`);
}