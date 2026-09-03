import Fastify from "fastify";
import { phoneRoutes } from "./routes/phones.js";
import { statsRoutes } from "./routes/stats.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

await app.register(phoneRoutes);
await app.register(statsRoutes);

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`phone-intelligence api listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
