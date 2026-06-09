import { ToolDefinition } from "../tools/registry";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  tool_call: LLMToolCall | null;
  input_tokens: number;
  output_tokens: number;
}

export interface LLMProvider {
  generate(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    model: string,
    maxTokens?: number
  ): Promise<LLMResponse>;
}
