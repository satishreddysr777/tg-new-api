import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { InviteService } from "../services/invite.service";
import { sendInviteEmail } from "../lib/mail";
import { setSessionCookie } from "../lib/session-cookie";
import { toPublicEmployee } from "../domain/employee";
import {
  AcceptInviteBody,
  InvitePrefillResponse,
  SessionResponse,
} from "../schemas/auth.schemas";
import {
  CreateInviteBody,
  CreateInviteResponse,
  InviteListResponse,
} from "../schemas/invite.schemas";

/**
 * Invite-based onboarding. Admins create invites (admin-guarded); invitees
 * validate and accept them with a public magic-link token, which establishes
 * a session cookie.
 */
const inviteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new InviteService({
    invites: app.invites,
    employees: app.employees,
    clients: app.clients,
    log: app.log,
    appUrl: app.config.APP_URL,
    inviteTtlHours: app.config.INVITE_TTL_HOURS,
    sendInvite: (args) => sendInviteEmail({ ...args, log: app.log }),
  });

  // ── Admin: create an invite ────────────────────────────────────────────
  app.post(
    "/invites",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["invites"],
        summary: "Create an onboarding invite and email a magic link",
        security: [{ bearerAuth: [] }],
        body: CreateInviteBody,
        response: { 200: CreateInviteResponse },
      },
    },
    async (request) =>
      service.createInvite({
        email: request.body.email,
        role: request.body.role,
        clientId: request.body.clientId,
        name: request.body.name,
        placement: {
          title: request.body.title,
          employmentType: request.body.employmentType,
          managerName: request.body.managerName,
          billRate: request.body.billRate,
          payRate: request.body.payRate,
          location: request.body.location,
          startDate: request.body.startDate,
          endDate: request.body.endDate,
        },
        invitedById: request.user.sub,
        inviterName: request.user.email,
      }),
  );

  // ── Admin: list invites ────────────────────────────────────────────────
  app.get(
    "/invites",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["invites"],
        summary: "List invites",
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          status: Type.Optional(
            Type.Union([
              Type.Literal("PENDING"),
              Type.Literal("ACCEPTED"),
              Type.Literal("REVOKED"),
            ]),
          ),
        }),
        response: { 200: InviteListResponse },
      },
    },
    async (request) => ({
      invites: await service.listInvites({ status: request.query.status }),
    }),
  );

  // ── Admin: revoke an invite ────────────────────────────────────────────
  app.post(
    "/invites/:id/revoke",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["invites"],
        summary: "Revoke a pending invite",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request) => {
      await service.revokeInvite(request.params.id);
      return { ok: true };
    },
  );

  // ── Public: validate a magic-link token (prefill onboarding) ───────────
  app.get(
    "/auth/invite/:token",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["invites"],
        summary: "Validate an invite token and return onboarding prefill data",
        params: Type.Object({ token: Type.String() }),
        response: { 200: InvitePrefillResponse },
      },
    },
    async (request) => service.getInviteByToken(request.params.token),
  );

  // ── Public: accept an invite → create account + session cookie ─────────
  app.post(
    "/auth/accept-invite",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["invites"],
        summary: "Accept an invite, create the account, and start a session",
        body: AcceptInviteBody,
        response: { 200: SessionResponse },
      },
    },
    async (request, reply) => {
      const employee = await service.acceptInvite(request.body);
      const token = app.jwt.sign({
        sub: employee.id,
        email: employee.email,
        role: employee.role,
      });
      setSessionCookie(reply, token);
      return { user: toPublicEmployee(employee) };
    },
  );
};

export default inviteRoutes;
