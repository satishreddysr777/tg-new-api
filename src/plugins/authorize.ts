import fp from "fastify-plugin";
import type { onRequestHookHandler } from "fastify";
import { ForbiddenError } from "../lib/errors";
import type { Role } from "../domain/employee";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Builds an onRequest guard that 403s unless the caller has one of `roles`.
     * Always pair it AFTER `authenticate`, which populates `request.user`:
     *   onRequest: [app.authenticate, app.requireRole("ADMIN")]
     */
    requireRole: (...roles: Role[]) => onRequestHookHandler;
  }
}

export default fp(
  async (app) => {
    app.decorate("requireRole", (...roles: Role[]): onRequestHookHandler => {
      return async (request) => {
        const role = request.user?.role;
        if (!role || !roles.includes(role)) {
          throw new ForbiddenError(
            "You don't have permission to perform this action.",
          );
        }
      };
    });
  },
  { name: "authorize", dependencies: ["jwt"] },
);
