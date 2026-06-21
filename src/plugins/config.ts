import fp from "fastify-plugin";
import { config, type AppConfig } from "../config/env";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

/** Makes the validated config available as `app.config` everywhere. */
export default fp(
  async (app) => {
    app.decorate("config", config);
  },
  { name: "config" },
);
