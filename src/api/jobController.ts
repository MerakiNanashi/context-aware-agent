import { Request, Response } from "express";
import { getJobById } from "../queue/jobs";

export async function getJobStatus(req: Request, res: Response): Promise<void> {
  const { jobId } = req.params;
  const job = getJobById(jobId);

  if (!job) {
    res.status(404).json({ error: `Job ${jobId} not found` });
    return;
  }

  res.status(200).json(job);
}
