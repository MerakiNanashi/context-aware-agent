import { Request, Response } from "express";
import { RunRequestSchema } from "../schemas/request";
import { createJob, getJobById } from "../queue/jobs";
import { enqueueJob } from "../queue/bullmq";
import { ZodError } from "zod";

export async function enqueueRoadmapJob(req: Request, res: Response): Promise<void> {
  let parsed;
  try {
    parsed = RunRequestSchema.parse(req.body);
  } catch (err) {
    res.status(400).json({ error: "Invalid request", details: (err as ZodError).errors });
    return;
  }

  const idempotencyKey = req.headers["idempotency-key"] as string | undefined
    ?? parsed.idempotency_key;

  // Check for duplicate submission
  if (idempotencyKey) {
    const existing = getJobById(idempotencyKey);
    if (existing) {
      res.status(200).json({ jobId: existing.jobId, status: existing.status });
      return;
    }
  }

  const job = createJob(parsed, idempotencyKey);

  try {
    await enqueueJob(job.jobId, parsed);
  } catch {
    // Fallback: if BullMQ/Redis unavailable, mark job as pending (worker picks it up in-memory)
    console.warn("Queue unavailable — job queued in-memory only");
  }

  res.status(202).json({ jobId: job.jobId, status: job.status });
}
