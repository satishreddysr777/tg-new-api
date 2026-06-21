import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { NotFoundError } from "../lib/errors";
import {
  ApplicationListResponse,
  ApplicationObject,
  CreateApplicationBody,
  UpdateStageBody,
} from "../schemas/application.schemas";

/** Application code from the live count, e.g. "A-2001". */
const codeFromCount = (count: number) => `A-${2000 + count + 1}`;

/**
 * Candidates applying to a job. Staff (ADMIN/EMPLOYER) list a job's applicants,
 * add candidates, view a candidate, and move them through the pipeline.
 */
const applicationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // ── A job's applicants ─────────────────────────────────────────────────
  app.get(
    "/jobs/:jobId/applications",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["applications"],
        summary: "List a job's applicants",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ jobId: Type.String() }),
        response: { 200: ApplicationListResponse },
      },
    },
    async (request) => {
      const job = await app.jobs.find(request.params.jobId);
      if (!job) throw new NotFoundError("Job not found.");
      return { applications: await app.applications.listByJob(job.id) };
    },
  );

  // ── Add a candidate to a job ───────────────────────────────────────────
  app.post(
    "/jobs/:jobId/applications",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["applications"],
        summary: "Add a candidate to a job",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ jobId: Type.String() }),
        body: CreateApplicationBody,
        response: { 200: ApplicationObject },
      },
    },
    async (request) => {
      const job = await app.jobs.find(request.params.jobId);
      if (!job) throw new NotFoundError("Job not found.");
      const applicationCode = codeFromCount(await app.applications.count());
      return app.applications.create({
        ...request.body,
        jobId: job.id,
        applicationCode,
        stage: request.body.stage ?? "Applied",
      });
    },
  );

  // ── A single candidate ─────────────────────────────────────────────────
  app.get(
    "/applications/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["applications"],
        summary: "Get a candidate by id or code (A-####)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: ApplicationObject },
      },
    },
    async (request) => {
      const application = await app.applications.find(request.params.id);
      if (!application) throw new NotFoundError("Application not found.");
      return application;
    },
  );

  // ── Download a candidate's résumé ──────────────────────────────────────
  app.get(
    "/applications/:id/resume",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["applications"],
        summary: "Download a candidate's résumé",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
      },
    },
    async (request, reply) => {
      const application = await app.applications.find(request.params.id);
      if (!application) throw new NotFoundError("Application not found.");
      const resume = await app.applications.getResume(application.id);
      if (!resume) throw new NotFoundError("No résumé on file.");

      const filename = (application.resumeName ?? "resume").replace(/"/g, "");
      // Inline so it can render in an <iframe> preview; the UI's download link
      // uses the `download` attribute when an explicit download is wanted.
      return reply
        .header("Content-Type", resume.mime)
        .header("Content-Disposition", `inline; filename="${filename}"`)
        .send(Buffer.from(resume.data, "base64"));
    },
  );

  // ── Move a candidate through the pipeline ──────────────────────────────
  app.patch(
    "/applications/:id/stage",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["applications"],
        summary: "Move a candidate to a different stage",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        body: UpdateStageBody,
        response: { 200: ApplicationObject },
      },
    },
    async (request) => {
      const application = await app.applications.find(request.params.id);
      if (!application) throw new NotFoundError("Application not found.");
      return app.applications.updateStage(application.id, request.body.stage);
    },
  );
};

export default applicationRoutes;
