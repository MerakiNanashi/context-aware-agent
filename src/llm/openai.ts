import OpenAI from "openai";
import { LLMProvider, LLMMessage, LLMResponse } from "./provider";
import { ToolDefinition } from "../tools/registry";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    model: string,
    maxTokens = 1024
  ): Promise<LLMResponse> {
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: allMessages,
      tools: openaiTools,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const msg = choice.message;

    let content: string | null = msg.content ?? null;
    let toolCall = null;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      try {
        toolCall = {
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        };
      } catch {
        toolCall = {
          name: tc.function.name,
          arguments: {},
        };
      }
    }

    return {
      content,
      tool_call: toolCall,
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
