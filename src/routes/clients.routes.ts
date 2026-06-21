import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { ConflictError, NotFoundError } from "../lib/errors";
import {
  ClientListResponse,
  ClientObject,
  CreateClientBody,
  UpdateClientBody,
} from "../schemas/invite.schemas";

/**
 * Client companies. Staff (ADMIN/EMPLOYER) can read the list — the Add Employee
 * page needs it to assign a placement. Only ADMIN can create, edit, or delete.
 * A client can be deleted only when no employees are placed there.
 */
const clientRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/clients",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["clients"],
        summary: "List client companies with their employee counts",
        security: [{ bearerAuth: [] }],
        response: { 200: ClientListResponse },
      },
    },
    async () => {
      const [list, counts] = await Promise.all([
        app.clients.list(),
        app.employees.employeeCountsByClient(),
      ]);
      return {
        clients: list.map((c) => ({ ...c, employeeCount: counts[c.id] ?? 0 })),
      };
    },
  );

  app.post(
    "/clients",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["clients"],
        summary: "Create a client company",
        security: [{ bearerAuth: [] }],
        body: CreateClientBody,
        response: { 200: ClientObject },
      },
    },
    async (request) =>
      app.clients.create({
        name: request.body.name,
        location: request.body.location,
        contactEmail: request.body.contactEmail,
      }),
  );

  app.patch(
    "/clients/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["clients"],
        summary: "Update a client company",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        body: UpdateClientBody,
        response: { 200: ClientObject },
      },
    },
    async (request) => {
      const updated = await app.clients.update(request.params.id, {
        name: request.body.name,
        location: request.body.location,
        contactEmail: request.body.contactEmail,
      });
      if (!updated) throw new NotFoundError("Client not found.");
      return updated;
    },
  );

  app.delete(
    "/clients/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["clients"],
        summary: "Delete a client (only when no employees are assigned)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request) => {
      const client = await app.clients.findById(request.params.id);
      if (!client) throw new NotFoundError("Client not found.");
      const counts = await app.employees.employeeCountsByClient();
      const assigned = counts[client.id] ?? 0;
      if (assigned > 0) {
        throw new ConflictError(
          `Can't delete ${client.name} — ${assigned} employee${assigned === 1 ? " is" : "s are"} still assigned.`,
        );
      }
      await app.clients.delete(client.id);
      return { ok: true };
    },
  );
};

export default clientRoutes;
