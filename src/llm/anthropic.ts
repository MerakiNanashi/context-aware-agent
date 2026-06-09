import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse } from "./provider";
import { ToolDefinition } from "../tools/registry";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    model: string,
    maxTokens = 1024
  ): Promise<LLMResponse> {
    
    // 1. Map tools safely without strictly depending on varying root 'Tool' namespaces
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as any,
    }));

    // 2. Cast the payload block to 'any' to dynamically pass parameters 
    // This stops TypeScript from rejecting 'tools' based on bad object overloads
    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages as any[], 
      tools: anthropicTools as any[],
    } as any);

    let content: string | null = null;
    let toolCall = null;

    // 3. Cast the response content block iteration so TypeScript knows 
    // any block type ('text' or 'tool_use') can safely access its corresponding fields
    for (const block of (response.content as any[])) {
      if (block.type === 'text') {
        content = block.text;
      } else if (block.type === 'tool_use') {
        toolCall = {
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        };
      }
    }

    return {
      content,
      tool_call: toolCall,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  }
}