import { v4 as uuidv4 } from "uuid";
import { Job } from "../schemas/async";
import { RunRequest } from "../schemas/request";
import { RunResponse } from "../schemas/response";

// In-memory store. In production replace with Redis/BullMQ persistence.
const jobs = new Map<string, Job>();

export function createJob(input: RunRequest, idempotencyKey?: string): Job {
  const jobId = idempotencyKey ?? uuidv4();
  const now = new Date().toISOString();
  const job: Job = {
    jobId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(jobId, job);
  return job;
}

export function getJobById(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function updateJobStatus(
  jobId: string,
  status: Job["status"],
  result?: RunResponse,
  error?: string
): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (result) job.result = result;
  if (error) job.error = error;
  jobs.set(jobId, job);
}
