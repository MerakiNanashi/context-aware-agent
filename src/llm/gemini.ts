import { GoogleGenAI, Content, Part, GenerateContentConfig, Tool } from '@google/genai';
import { LLMProvider, LLMMessage, LLMResponse } from "./provider";
import { ToolDefinition } from "../tools/registry";

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    model: string = 'gemini-2.5-flash',
    maxTokens = 1024,
    debug: boolean = true
  ): Promise<LLMResponse> {
    
    // FIX 2: Correct structure for the tools configuration array
    const geminiTools: Tool[] | undefined = tools.length > 0 ? [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as any, 
      }))
    }] : undefined;

    // FIX 1: Map text history AND tool execution results properly
    const geminiContents: Content[] = messages.map((m) => {
      // If your system architecture defines a tool/function response role
      const msgRaw = m as any;

      if (msgRaw.role === 'tool' || msgRaw.role === 'function') {
        return {
          role: 'tool',
          parts: [{
            functionResponse: {
              name: msgRaw.name || 'unknown_tool',
              response: typeof m.content === 'string' ? JSON.parse(m.content) : m.content
            }
          }]
        };
      }

      // Standard user/model text dialogue
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content } as Part]
      };
    });

    const config: GenerateContentConfig = {
      systemInstruction: systemPrompt,
      maxOutputTokens: maxTokens,
      tools: geminiTools,
    };

    const response = await this.ai.models.generateContent({
      model: model,
      contents: geminiContents,
      config: config,
    });
    
    if (debug) {
      console.log("Config:", JSON.stringify(config, null, 2));
      console.log("Content:", JSON.stringify(geminiContents, null, 2));
      console.log("Tools:", JSON.stringify(geminiTools, null, 2));
    }

    let content: string | null = null;
    let toolCall = null;

    if (response.text) {
      content = response.text;
    }

    // FIX 3: Look through ALL parts safely instead of hardcoding index [0]
    // Look through ALL parts safely
    const parts = response.candidates?.[0]?.content?.parts || [];
    const functionCallPart = parts.find((part: any) => 'functionCall' in part && part.functionCall);

    if (functionCallPart && functionCallPart.functionCall) {
      toolCall = {
        // FIX: Fallback to an empty string or 'unknown' so it cannot be undefined
        name: functionCallPart.functionCall.name || 'unknown_tool',
        arguments: functionCallPart.functionCall.args as unknown as Record<string, unknown>,
      };
    }

    return {
      content,
      tool_call: toolCall,
      input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}