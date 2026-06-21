import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors";
import {
  EmployeeListResponse,
  EmployeeObject,
  EndEngagementBody,
  EngagementHistoryListResponse,
  ManagerListResponse,
} from "../schemas/employee.schemas";

/**
 * Workforce directory. Staff (ADMIN/EMPLOYER) read the employee list and detail
 * — each row joins the user identity and client placement onto the profile.
 */
const employeeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/employees",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["employees"],
        summary: "List employees",
        security: [{ bearerAuth: [] }],
        response: { 200: EmployeeListResponse },
      },
    },
    async () => ({ employees: await app.employees.listDirectory() }),
  );

  // ── Internal staff selectable as a manager ─────────────────────────────
  app.get(
    "/managers",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["employees"],
        summary: "List internal staff (ADMIN/EMPLOYER) selectable as a manager",
        security: [{ bearerAuth: [] }],
        response: { 200: ManagerListResponse },
      },
    },
    async () => {
      const staff = await app.employees.listManagers();
      return {
        managers: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })),
      };
    },
  );

  app.get(
    "/employees/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["employees"],
        summary: "Get an employee by id or employee code (TG-####)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: EmployeeObject },
      },
    },
    async (request) => {
      const employee = await app.employees.findDirectory(request.params.id);
      if (!employee) throw new NotFoundError("Employee not found.");
      return employee;
    },
  );

  // ── End an employee's current placement ────────────────────────────────
  app.patch(
    "/employees/:id/end-engagement",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["employees"],
        summary: "End the current placement: bench the employee, record history",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        body: EndEngagementBody,
        response: { 200: EmployeeObject },
      },
    },
    async (request) => {
      const employee = await app.employees.findDirectory(request.params.id);
      if (!employee) throw new NotFoundError("Employee not found.");
      if (!employee.clientId) {
        throw new BadRequestError("This employee has no active engagement to end.");
      }

      const endDate = new Date(request.body.endDate);

      // Snapshot the placement before unassigning the client.
      await app.engagementHistory.create({
        employeeId: employee.id,
        clientId: employee.clientId,
        clientName: employee.clientName ?? "—",
        title: employee.title,
        startDate: employee.startDate ? new Date(employee.startDate) : null,
        endDate,
        billRate: employee.billRate,
        payRate: employee.payRate,
        reason: request.body.reason ?? null,
      });

      await app.employees.endEngagement(employee.id, { endDate });

      const updated = await app.employees.findDirectory(employee.id);
      if (!updated) throw new NotFoundError("Employee not found.");
      return updated;
    },
  );

  // ── Delete a benched employee ──────────────────────────────────────────
  app.delete(
    "/employees/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN")],
      schema: {
        tags: ["employees"],
        summary: "Delete an employee (only when On bench)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request) => {
      const employee = await app.employees.findDirectory(request.params.id);
      if (!employee) throw new NotFoundError("Employee not found.");
      if (employee.status !== "On bench") {
        throw new ConflictError(
          "Only employees on the bench can be deleted. End their engagement first.",
        );
      }
      await app.employees.delete(employee.id);
      return { ok: true };
    },
  );

  // ── List an employee's past placements ─────────────────────────────────
  app.get(
    "/employees/:id/engagements",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["employees"],
        summary: "List an employee's ended placements (newest first)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: EngagementHistoryListResponse },
      },
    },
    async (request) => {
      const employee = await app.employees.findDirectory(request.params.id);
      if (!employee) throw new NotFoundError("Employee not found.");
      return {
        engagements: await app.engagementHistory.listByEmployee(employee.id),
      };
    },
  );
};

export default employeeRoutes;
