import type { FastifyInstance } from "fastify";
import { healthCheck } from "../repository.js";
import { ok, fail } from "../contracts.js";

export default async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/live", async () => {
    return ok({ status: "live" });
  });

  app.get("/health", async (request, reply) => {
    try {
      const checks = await healthCheck();
      return ok({ status: "ok", ...checks });
    } catch (err) {
      request.log.error({ err }, "health check failed");
      return reply.code(503).send(fail("HEALTH_CHECK_FAILED", "Database or PostGIS unavailable"));
    }
  });

  app.get("/", async () => {
    return ok({ service: "networkpeer-api", version: "1.0.0", status: "running" });
  });
}
