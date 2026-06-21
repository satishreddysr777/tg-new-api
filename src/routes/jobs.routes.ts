import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { NotFoundError } from "../lib/errors";
import {
  CreateJobBody,
  JobListResponse,
  JobObject,
  NextJobCodeResponse,
  UpdateJobBody,
} from "../schemas/job.schemas";

/** Next job code from the live count, e.g. 12 jobs → "JOB-0013". */
const codeFromCount = (count: number) =>
  `JOB-${String(count + 1).padStart(4, "0")}`;

/**
 * Hiring requisitions. Staff (ADMIN/EMPLOYER) create and list jobs. The job
 * code is assigned server-side from the current job count so it can't be forged
 * or collide with a stale client-side value.
 */
const jobRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/jobs",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["jobs"],
        summary: "List jobs",
        security: [{ bearerAuth: [] }],
        response: { 200: JobListResponse },
      },
    },
    async () => ({ jobs: await app.jobs.listWithClient() }),
  );

  // Preview the code the next job will be assigned.
  app.get(
    "/jobs/next-code",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["jobs"],
        summary: "Preview the next job code (derived from the job count)",
        security: [{ bearerAuth: [] }],
        response: { 200: NextJobCodeResponse },
      },
    },
    async () => ({ code: codeFromCount(await app.jobs.count()) }),
  );

  app.get(
    "/jobs/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["jobs"],
        summary: "Get a job by id or job code (JOB-####)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: JobObject },
      },
    },
    async (request) => {
      const job = await app.jobs.find(request.params.id);
      if (!job) throw new NotFoundError("Job not found.");
      return job;
    },
  );

  app.post(
    "/jobs",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["jobs"],
        summary: "Create a job (draft or published)",
        security: [{ bearerAuth: [] }],
        body: CreateJobBody,
        response: { 200: JobObject },
      },
    },
    async (request) => {
      const jobCode = codeFromCount(await app.jobs.count());
      const job = await app.jobs.create({ ...request.body, jobCode });

      let clientName: string | null = null;
      if (job.clientId) {
        const client = await app.clients.findById(job.clientId);
        clientName = client?.name ?? null;
      }
      return { ...job, clientName };
    },
  );

  app.patch(
    "/jobs/:id",
    {
      onRequest: [app.authenticate, app.requireRole("ADMIN", "EMPLOYER")],
      schema: {
        tags: ["jobs"],
        summary: "Update a job (edit fields or change Draft/Published)",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        body: UpdateJobBody,
        response: { 200: JobObject },
      },
    },
    async (request) => {
      const existing = await app.jobs.find(request.params.id);
      if (!existing) throw new NotFoundError("Job not found.");
      const updated = await app.jobs.update(existing.id, request.body);
      if (!updated) throw new NotFoundError("Job not found.");

      let clientName: string | null = null;
      if (updated.clientId) {
        const client = await app.clients.findById(updated.clientId);
        clientName = client?.name ?? null;
      }
      return { ...updated, clientName };
    },
  );
};

export default jobRoutes;
