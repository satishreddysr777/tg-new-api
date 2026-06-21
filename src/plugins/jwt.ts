import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../lib/errors";
import type { Role } from "../domain/employee";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    /** Route-level guard: rejects requests without a valid access token. */
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

/**
 * Registers JWT signing/verification and exposes an `authenticate` decorator
 * that protected routes attach via `onRequest`.
 */
export default fp(
  async (app) => {
    await app.register(jwt, {
      secret: app.config.JWT_SECRET,
      sign: { expiresIn: app.config.JWT_ACCESS_TTL },
      // Read the token from the httpOnly session cookie. `jwtVerify()` still
      // falls back to the Authorization header, so API clients keep working.
      cookie: {
        cookieName: app.config.SESSION_COOKIE_NAME,
        signed: false,
      },
    });

    app.decorate(
      "authenticate",
      async (request: FastifyRequest): Promise<void> => {
        try {
          await request.jwtVerify();
        } catch {
          throw new UnauthorizedError("Missing or invalid access token.");
        }
      },
    );
  },
  { name: "jwt", dependencies: ["error-handler"] },
);
