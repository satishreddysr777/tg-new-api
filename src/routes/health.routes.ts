import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";

const startedAt = Date.now();

/** Liveness/readiness probes — unauthenticated, excluded from rate limiting. */
const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/health",
    {
      config: { rateLimit: false },
      schema: {
        tags: ["health"],
        summary: "Liveness & readiness probe",
        response: {
          200: Type.Object({
            status: Type.Literal("ok"),
            uptimeSeconds: Type.Number(),
            timestamp: Type.String(),
          }),
        },
      },
    },
    async () => ({
      status: "ok" as const,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    }),
  );
};

export default healthRoutes;
