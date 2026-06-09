import "dotenv/config";
import express from "express";
import { runRoadmapCopilot } from "./api/roadmapController";
import { enqueueRoadmapJob } from "./api/asyncController";
import { getJobStatus } from "./api/jobController";
import { startWorker } from "./queue/worker";

const app = express();
app.use(express.json());

// Sync run
app.post("/ai/roadmap-copilot/run", runRoadmapCopilot);

// Async run (bonus)
app.post("/ai/roadmap-copilot/run/async", enqueueRoadmapJob);

// Job status (bonus)
app.get("/ai/roadmap-copilot/jobs/:jobId", getJobStatus);

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = parseInt(process.env.PORT ?? "3000");
app.listen(PORT, () => {
  console.log(`Roadmap copilot listening on port ${PORT}`);
  startWorker();
});

export { app };
