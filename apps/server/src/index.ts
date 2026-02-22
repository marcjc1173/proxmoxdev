import cors from "cors";
import express from "express";
import { evaluateAlarms } from "./alarms.js";
import { config } from "./config.js";
import { initPolicyGuardrailsStore } from "./policyGuardrails.js";
import { apiRouter } from "./routes.js";
import { initUserStore } from "./userStore.js";
import { MetricsCollector } from "./metricsCollector.js";
import { proxmoxClient } from "./proxmoxClient.js";
import { initMetricsStore } from "./metricsStore.js";

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use("/api", apiRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  res.status(500).json({
    error: "Internal server error",
    message
  });
});

await initUserStore();
await initPolicyGuardrailsStore();
await evaluateAlarms();

// Initialize metrics database and cleanup schedule
initMetricsStore();

setInterval(() => {
  void evaluateAlarms();
}, config.alarms.pollIntervalSeconds * 1000);

// Start metrics collection
const metricsCollector = new MetricsCollector(proxmoxClient, 5);
metricsCollector.start();

app.listen(config.port, () => {
  console.log(`Proxmox Center API listening on http://localhost:${config.port}`);
});
