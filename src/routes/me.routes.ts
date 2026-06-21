import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../lib/errors";
import { toPublicEmployee } from "../domain/employee";
import type { JobWithClient } from "../domain/job";
import {
  CompleteOnboardingBody,
  MeResponse,
  PortalApplicationListResponse,
  PortalApplyBody,
  PortalApplyResponse,
  PortalRoleListResponse,
} from "../schemas/me.schemas";

/** Mask a phone number for display, keeping only the last four digits. */
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const last4 = digits.slice(-4).padStart(4, "·");
  return `···· ·· ${last4}`;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Percent of a job's required stack the employee already has (0–100). */
function fitScore(jobStack: string[], mineStack: string[]): number {
  if (jobStack.length === 0) return 0;
  const mine = new Set(mineStack.map(norm));
  const hits = jobStack.filter((s) => mine.has(norm(s))).length;
  return Math.round((hits / jobStack.length) * 100);
}

/** Next application code from the live count, e.g. "A-2001". */
const applicationCode = (count: number) => `A-${2000 + count + 1}`;

/**
 * The signed-in user's own profile. `/me` returns the full profile (the portal
 * reads it to gate onboarding); the onboarding endpoint lets a new hire fill in
 * their personal details and flips their status from Onboarding to Active.
 */
const meRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/me",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["me"],
        summary: "Return the signed-in user's full profile",
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse },
      },
    },
    async (request) => {
      const employee = await app.employees.findById(request.user.sub);
      if (!employee) throw new NotFoundError("Account not found.");
      let clientName: string | null = null;
      if (employee.clientId) {
        const client = await app.clients.findById(employee.clientId);
        clientName = client?.name ?? null;
      }
      return { ...toPublicEmployee(employee), clientName };
    },
  );

  app.patch(
    "/me/onboarding",
    {
      onRequest: [app.authenticate, app.requireRole("EMPLOYEE")],
      schema: {
        tags: ["me"],
        summary: "Complete onboarding — save personal details and go Active",
        security: [{ bearerAuth: [] }],
        body: CompleteOnboardingBody,
        response: { 200: MeResponse },
      },
    },
    async (request) => {
      const employee = await app.employees.findById(request.user.sub);
      if (!employee) throw new NotFoundError("Account not found.");
      if (employee.status !== "Onboarding") {
        throw new BadRequestError("Onboarding has already been completed.");
      }
      const updated = await app.employees.completeOnboarding(employee.id, {
        name: request.body.name.trim(),
        phoneHint: maskPhone(request.body.phone),
        location: request.body.location.trim(),
        stack: request.body.stack.map((s) => s.trim()).filter(Boolean),
        status: "Active",
      });
      let clientName: string | null = null;
      if (updated.clientId) {
        const client = await app.clients.findById(updated.clientId);
        clientName = client?.name ?? null;
      }
      return { ...toPublicEmployee(updated), clientName };
    },
  );

  // ── Open roles the employee can move into ──────────────────────────────
  app.get(
    "/me/roles",
    {
      onRequest: [app.authenticate, app.requireRole("EMPLOYEE")],
      schema: {
        tags: ["me"],
        summary: "List published roles, scored against the employee's stack",
        security: [{ bearerAuth: [] }],
        response: { 200: PortalRoleListResponse },
      },
    },
    async (request) => {
      const me = await app.employees.findById(request.user.sub);
      if (!me) throw new NotFoundError("Account not found.");

      const published = (await app.jobs.listWithClient()).filter(
        (j) => j.status === "Published",
      );
      const mine = await app.applications.listByApplicantEmail(me.email);
      const appliedJobIds = new Set(mine.map((a) => a.jobId));

      const roles = published.map((j: JobWithClient) => ({
        jobCode: j.jobCode,
        title: j.title,
        clientName: j.clientName,
        department: j.department,
        engagementType: j.engagementType,
        location: j.location,
        compType: j.compType,
        compMin: j.compMin,
        compMax: j.compMax,
        stack: j.stack,
        summary: j.summary,
        responsibilities: j.responsibilities,
        matchPct: fitScore(j.stack, me.stack),
        applied: appliedJobIds.has(j.id),
        createdAt: j.createdAt,
      }));
      // Best fit first, then most recently posted.
      roles.sort(
        (a, b) =>
          b.matchPct - a.matchPct || b.createdAt.localeCompare(a.createdAt),
      );
      return { roles };
    },
  );

  // ── Apply to a published role ──────────────────────────────────────────
  app.post(
    "/me/roles/:code/apply",
    {
      // Allow a base64 résumé in the body (≈8MB ceiling).
      bodyLimit: 9_000_000,
      onRequest: [app.authenticate, app.requireRole("EMPLOYEE")],
      schema: {
        tags: ["me"],
        summary: "Apply to a published role using the employee's own profile",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ code: Type.String() }),
        body: PortalApplyBody,
        response: { 200: PortalApplyResponse },
      },
    },
    async (request) => {
      const me = await app.employees.findById(request.user.sub);
      if (!me) throw new NotFoundError("Account not found.");

      const job = await app.jobs.find(request.params.code);
      if (!job || job.status !== "Published") {
        throw new NotFoundError("This role isn't open.");
      }

      const mine = await app.applications.listByApplicantEmail(me.email);
      if (mine.some((a) => a.jobId === job.id)) {
        throw new ConflictError("You've already applied to this role.");
      }

      const { resumeData, resumeMime, resumeName } = request.body;
      const created = await app.applications.create({
        jobId: job.id,
        applicationCode: applicationCode(await app.applications.count()),
        name: me.name,
        email: me.email,
        location: me.location,
        source: "Employee portal",
        compAsk: request.body.compAsk ?? null,
        matchPct: fitScore(job.stack, me.stack),
        summary: request.body.summary ?? null,
        skills: me.stack,
        linkedin: request.body.linkedin ?? null,
        resumeName: resumeName ?? null,
        stage: "Applied",
      });
      if (resumeData && resumeName) {
        await app.applications.saveResume(created.id, {
          mime: resumeMime ?? "application/octet-stream",
          data: resumeData,
        });
      }
      return { ok: true, applicationCode: created.applicationCode };
    },
  );

  // ── Download the résumé on one of the employee's own applications ───────
  app.get(
    "/me/applications/:id/resume",
    {
      onRequest: [app.authenticate, app.requireRole("EMPLOYEE")],
      schema: {
        tags: ["me"],
        summary: "Download the résumé attached to the employee's own application",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
      },
    },
    async (request, reply) => {
      const me = await app.employees.findById(request.user.sub);
      if (!me) throw new NotFoundError("Account not found.");

      const application = await app.applications.find(request.params.id);
      // Only the application's own owner may read its résumé.
      if (
        !application ||
        norm(application.email ?? "") !== norm(me.email)
      ) {
        throw new NotFoundError("Application not found.");
      }
      const resume = await app.applications.getResume(application.id);
      if (!resume) throw new NotFoundError("No résumé on file.");

      const filename = (application.resumeName ?? "resume").replace(/"/g, "");
      return reply
        .header("Content-Type", resume.mime)
        .header("Content-Disposition", `inline; filename="${filename}"`)
        .send(Buffer.from(resume.data, "base64"));
    },
  );

  // ── The employee's own applications ────────────────────────────────────
  app.get(
    "/me/applications",
    {
      onRequest: [app.authenticate, app.requireRole("EMPLOYEE")],
      schema: {
        tags: ["me"],
        summary: "List the signed-in employee's own applications",
        security: [{ bearerAuth: [] }],
        response: { 200: PortalApplicationListResponse },
      },
    },
    async (request) => {
      const me = await app.employees.findById(request.user.sub);
      if (!me) throw new NotFoundError("Account not found.");
      return {
        applications: await app.applications.listByApplicantEmail(me.email),
      };
    },
  );
};

export default meRoutes;
