import { z } from "zod";
import { RunResponseSchema } from "./response";

export const JobStatusSchema = z.enum(["pending", "running", "completed", "failed"]);

export const JobSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  result: RunResponseSchema.optional(),
  error: z.string().optional(),
});

export type JobStatus = z.infer<typeof JobStatusSchema>;
export type Job = z.infer<typeof JobSchema>;
