import { LLMProvider, LLMMessage, LLMResponse } from "../llm/provider";
import { ToolDefinition } from "../tools/registry";
import { buildRetryPrompt } from "../llm/promptBuilder";

/**
 * Retry once with a stricter prompt when LLM output is invalid.
 */
export async function retryWithStrictPrompt(
  provider: LLMProvider,
  originalSystemPrompt: string,
  messages: LLMMessage[],
  tools: ToolDefinition[],
  model: string,
  parseError: string
): Promise<LLMResponse> {
  const strictPrompt = buildRetryPrompt(originalSystemPrompt, parseError);
  return provider.generate(strictPrompt, messages, tools, model, 512);
}
