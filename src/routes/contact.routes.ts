import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { NotFoundError } from "../lib/errors";
import {
  sendContactAlertEmail,
  sendContactReceivedEmail,
} from "../lib/mail";
import {
  ContactBody,
  ContactMessageListResponse,
  ContactMessageObject,
  ContactResponse,
  UpdateContactStatusBody,
} from "../schemas/contact.schemas";

/**
 * Public contact form + the staff-facing inbox.
 *
 * - POST /contact is public (rate-limited): it stores the message and fires the
 *   notification emails. Both emails are best-effort and never block the 200.
 * - GET/PATCH/DELETE /contact/messages are staff-only (ADMIN/EMPLOYER) and back
 *   the "Messages" section of the Employer Console.
 */
const contactRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/contact",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["contact"],
        summary: "Submit the public contact form (no login required)",
        body: ContactBody,
        response: { 200: ContactResponse },
      },
    },
    async (request) => {
      const { intent, name, email, company, phone, message } = request.body;

      // Persist first — this is the record of record. If it fails, the request
      // fails (the visitor sees an error) rather than silently dropping a lead.
      await app.contactMessages.create({
        intent,
        name,
        email,
        company,
        phone,
        message,
      });

      // Notify the team and confirm to the sender — best-effort, never blocks.
      const appUrl = app.config.APP_URL.replace(/\/$/, "");
      void (async () => {
        try {
          const configured = app.config.HIRING_NOTIFY_EMAIL.trim();
          let recipients: string[] = configured ? [configured] : [];
          if (!recipients.length) {
            const staff = await app.employees.listManagers();
            recipients = staff
              .filter((s) => s.role === "ADMIN")
              .map((s) => s.email);
          }
          if (recipients.length) {
            await sendContactAlertEmail({
              to: recipients,
              name,
              email,
              intent,
              company,
              phone,
              message,
              log: app.log,
            });
          }
        } catch (err) {
          app.log.error({ err }, "Contact-team alert email failed");
        }
        try {
          await sendContactReceivedEmail({ to: email, name, appUrl, log: app.log });
        } catch (err) {
          app.log.error({ err }, "Contact confirmation email failed");
        }
      })();

      return { ok: true };
    },
  );

  app.get(
    "/contact/messages",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["contact"],
        summary: "List inbound contact messages (newest first)",
        security: [{ bearerAuth: [] }],
        response: { 200: ContactMessageListResponse },
      },
    },
    async () => ({ messages: await app.contactMessages.list() }),
  );

  app.patch(
    "/contact/messages/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["contact"],
        summary: "Update a contact message's status (NEW / READ / ARCHIVED)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        body: UpdateContactStatusBody,
        response: { 200: ContactMessageObject },
      },
    },
    async (request) => {
      const updated = await app.contactMessages.updateStatus(
        request.params.id,
        request.body.status,
      );
      if (!updated) throw new NotFoundError("Message not found.");
      return updated;
    },
  );

  app.delete(
    "/contact/messages/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["contact"],
        summary: "Delete a contact message",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request) => {
      const found = await app.contactMessages.findById(request.params.id);
      if (!found) throw new NotFoundError("Message not found.");
      await app.contactMessages.delete(found.id);
      return { ok: true };
    },
  );
};

export default contactRoutes;
