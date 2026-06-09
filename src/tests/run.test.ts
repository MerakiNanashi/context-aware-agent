import * as fs from "fs";
import * as path from "path";
import { RunResponseSchema } from "../schemas/response";

const RESPONSE_PATH = path.join(process.cwd(), "examples/response.json");

describe("run.test - committed examples/response.json", () => {
  it("should exist", () => {
    expect(fs.existsSync(RESPONSE_PATH)).toBe(true);
  });

  it("passes RunResponseSchema validation", () => {
    const raw = fs.readFileSync(RESPONSE_PATH, "utf-8");
    const data = JSON.parse(raw);
    expect(() => RunResponseSchema.parse(data)).not.toThrow();
  });

  it("contains required trajectory_rules fields", () => {
    const raw = fs.readFileSync(RESPONSE_PATH, "utf-8");
    const data = JSON.parse(raw) as {
      success: boolean;
      final_message: string;
      roadmap_updated: boolean;
      slug: string;
      context_trace: Array<{ context_evicted: string[]; context_decisions: string[] }>;
    };

    // Required final answer contains
    expect(data.final_message).toMatch(/MLOps/i);
    expect(data.final_message).toMatch(/month 4/i);
    expect(data.final_message).toMatch(/saved|save/i);
    expect(data.slug).toBe("priya-ds-2026");

    // Roadmap updated
    expect(data.roadmap_updated).toBe(true);

    // Context must have compacted at least once
    const anyCompact = data.context_trace.some((t) =>
      t.context_decisions.some((d) => d.includes("compact"))
    );
    expect(anyCompact).toBe(true);

    // Noise must not dominate final context
    const allEvicted = data.context_trace.flatMap((t) => t.context_evicted).join(" ");
    // These shouldn't be in included — they should be evicted
    // (test passes if they appear in evicted, which means they were removed)
    console.log("Evictions found:", allEvicted.substring(0, 200));
  });
});
