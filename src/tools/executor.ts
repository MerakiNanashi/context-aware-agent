import { ToolContext, ToolError } from "../agent/types";
import { getTool } from "./registry";
import { ToolResult } from "../schemas/tool";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const fn = getTool(name);
  if (!fn) {
    return {
      tool_name: name,
      success: false,
      error: `Unknown tool: ${name}`,
    };
  }

  try {
    const result = await fn(args, ctx);
    return {
      tool_name: name,
      success: true,
      result,
    };
  } catch (err) {
    if (err instanceof ToolError) {
      return {
        tool_name: name,
        success: false,
        error: err.message,
      };
    }
    return {
      tool_name: name,
      success: false,
      error: `Unexpected error in ${name}: ${(err as Error).message}`,
    };
  }
}
