import { z } from "zod";

export const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const ToolResultSchema = z.object({
  tool_name: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
