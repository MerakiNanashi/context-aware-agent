import { ToolContext, ToolError } from "../agent/types";
import * as fs from "fs";
import * as path from "path";

const KB_PATH = path.join(process.cwd(), "kb.json");

interface KbChunk {
  id: string;
  keywords: string[];
  estimated_tokens: number;
  text: string;
}

interface KbFile {
  chunks: KbChunk[];
}

export async function searchKb(
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<{ chunks: KbChunk[] }> {
  const query = (args.query as string) ?? "";
  if (!query) {
    throw new ToolError("query is required", "search_kb", false);
  }

  try {
    const raw = fs.readFileSync(KB_PATH, "utf-8");
    const kb = JSON.parse(raw) as KbFile;

    const qLower = query.toLowerCase();
    const scored = kb.chunks
      .map((chunk) => {
        const matchCount = chunk.keywords.filter((kw) =>
          qLower.includes(kw.toLowerCase())
        ).length;
        const textMatch = chunk.text.toLowerCase().includes(qLower) ? 1 : 0;
        return { chunk, score: matchCount + textMatch };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return { chunks: scored.slice(0, 2).map((x) => x.chunk) };
  } catch (err) {
    throw new ToolError(
      `KB search failed: ${(err as Error).message}`,
      "search_kb",
      false
    );
  }
}

export const searchKbDefinition = {
  name: "search_kb",
  description:
    "Search the knowledge base for relevant content (topics, prerequisites, context).",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query, e.g. 'MLOps month 4'",
      },
    },
    required: ["query"],
  },
};
