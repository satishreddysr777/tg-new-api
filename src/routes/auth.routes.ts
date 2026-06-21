import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { AuthService } from "../services/auth.service";
import { PasswordResetService } from "../services/password-reset.service";
import { sendPasswordResetEmail } from "../lib/mail";
import {
  setSessionCookie,
  clearSessionCookie,
} from "../lib/session-cookie";
import {
  AuthOutcomeResponse,
  ForgotBody,
  ForgotResponse,
  LoginBody,
  ResetPasswordBody,
  SessionResponse,
  VerifyBody,
} from "../schemas/auth.schemas";

/**
 * Auth endpoints. The service is constructed per-plugin from app-level
 * singletons (repository + challenge store), with the JWT signer injected
 * so the service has no direct dependency on the web framework.
 *
 * Sessions live in an httpOnly cookie: the service returns a signed token and
 * the route writes it to the cookie — the token never appears in a body.
 */
const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new AuthService({
    employees: app.employees,
    challenges: app.challenges,
    log: app.log,
    mfaEnabled: app.config.MFA_ENABLED,
    signAccessToken: (payload) =>
      app.jwt.sign({ sub: payload.sub, email: payload.email, role: payload.role }),
  });

  const resetService = new PasswordResetService({
    employees: app.employees,
    resets: app.passwordResets,
    log: app.log,
    appUrl: app.config.APP_URL,
    ttlMinutes: 30,
    sendReset: (args) => sendPasswordResetEmail({ ...args, log: app.log }),
  });

  // A stricter limit on credential endpoints to slow brute-force attempts.
  const authRateLimit = {
    rateLimit: { max: 10, timeWindow: "1 minute" },
  };

  app.post(
    "/auth/login",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Verify credentials; issue a 2FA challenge or a session cookie",
        body: LoginBody,
        response: { 200: AuthOutcomeResponse },
      },
    },
    async (request, reply) => {
      const outcome = await service.login(request.body);
      if ("accessToken" in outcome) {
        setSessionCookie(reply, outcome.accessToken);
        return { user: outcome.user };
      }
      return outcome; // pending 2FA challenge
    },
  );

  app.post(
    "/auth/verify",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Exchange a 2FA code for a session cookie",
        body: VerifyBody,
        response: { 200: SessionResponse },
      },
    },
    async (request, reply) => {
      const result = await service.verify(request.body);
      setSessionCookie(reply, result.accessToken);
      return { user: result.user };
    },
  );

  app.post(
    "/auth/forgot-password",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Request a password-reset link (never reveals existence)",
        body: ForgotBody,
        response: { 200: ForgotResponse },
      },
    },
    async (request) => {
      await resetService.request(request.body.email);
      return { sent: true };
    },
  );

  app.get(
    "/auth/reset/:token",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Validate a password-reset token",
        params: Type.Object({ token: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request) => {
      await resetService.validate(request.params.token);
      return { ok: true };
    },
  );

  app.post(
    "/auth/reset-password",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Set a new password using a reset token",
        body: ResetPasswordBody,
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request) => {
      await resetService.reset(request.body);
      return { ok: true };
    },
  );

  app.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Clear the session cookie",
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (_request, reply) => {
      clearSessionCookie(reply);
      return { ok: true };
    },
  );

  app.get(
    "/auth/me",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["auth"],
        summary: "Return the authenticated user",
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            sub: Type.String(),
            email: Type.String(),
            role: Type.String(),
          }),
        },
      },
    },
    async (request) => request.user,
  );
};

export default authRoutes;
