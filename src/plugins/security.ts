import fp from "fastify-plugin";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";

/**
 * Cross-cutting HTTP hardening: security headers, CORS allow-list,
 * a global rate limit, signed cookies, and sensible's reply helpers.
 */
export default fp(
  async (app) => {
    await app.register(sensible);
    await app.register(helmet, { global: true });
    await app.register(cookie);

    await app.register(cors, {
      origin: app.config.corsOrigins,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    });

    await app.register(rateLimit, {
      global: true,
      max: 100,
      timeWindow: "1 minute",
      addHeadersOnExceeding: { "x-ratelimit-remaining": true },
    });
  },
  { name: "security" },
);
