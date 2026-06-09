import { ToolContext } from "../agent/types";

export interface FinishArgs {
  message: string;
}

export async function finish(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ done: true; message: string }> {
  const message = (args.message as string) ?? "Done.";
  ctx.state.finalMessage = message;
  return { done: true, message };
}

export const finishDefinition = {
  name: "finish",
  description:
    "End the run with a user-facing message summarising what changed and the roadmap slug.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "Concise user-facing summary, must mention what changed and the roadmap slug.",
      },
    },
    required: ["message"],
  },
};
