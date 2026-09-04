import Fastify from "fastify";
import { phoneRoutes } from "./routes/phones.js";
import { statsRoutes } from "./routes/stats.js";
import { callDirectoryRoutes } from "./routes/callDirectory.js";
import { callLogRoutes } from "./routes/callLog.js";
import { acquisitionRoutes } from "./routes/acquisition.js";
import { monitoringRoutes } from "./routes/monitoring.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

await app.register(phoneRoutes);
await app.register(statsRoutes);
await app.register(callDirectoryRoutes);
await app.register(callLogRoutes);
await app.register(acquisitionRoutes);
await app.register(monitoringRoutes);

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`phone-intelligence api listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
