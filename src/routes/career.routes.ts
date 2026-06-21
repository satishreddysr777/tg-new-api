import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { NotFoundError } from "../lib/errors";
import type { Job } from "../domain/job";
import {
  sendApplicationAlertEmail,
  sendApplicationReceivedEmail,
} from "../lib/mail";
import {
  CareerApplyBody,
  CareerApplyResponse,
  PublicJobListResponse,
  PublicJobObject,
} from "../schemas/career.schemas";

/** Careers-safe projection of a job (drops client + internal fields). */
const toPublic = (j: Job) => ({
  jobCode: j.jobCode,
  title: j.title,
  department: j.department,
  engagementType: j.engagementType,
  location: j.location,
  summary: j.summary,
  responsibilities: j.responsibilities,
  stack: j.stack,
});

const applicationCode = (count: number) => `A-${2000 + count + 1}`;

/**
 * Public careers board. No authentication — anyone can browse published roles
 * and apply. Apply is rate-limited to deter spam. Only Published jobs are
 * visible or applyable; drafts 404.
 */
const careerRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/careers/jobs",
    {
      schema: {
        tags: ["careers"],
        summary: "List published roles (public)",
        response: { 200: PublicJobListResponse },
      },
    },
    async () => ({ jobs: (await app.jobs.listPublished()).map(toPublic) }),
  );

  app.get(
    "/careers/jobs/:code",
    {
      schema: {
        tags: ["careers"],
        summary: "Get a published role by code (public)",
        params: Type.Object({ code: Type.String() }),
        response: { 200: PublicJobObject },
      },
    },
    async (request) => {
      const job = await app.jobs.find(request.params.code);
      if (!job || job.status !== "Published") {
        throw new NotFoundError("This role isn't open.");
      }
      return toPublic(job);
    },
  );

  app.post(
    "/careers/jobs/:code/apply",
    {
      // Allow a base64 résumé in the body (≈8MB ceiling).
      bodyLimit: 9_000_000,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["careers"],
        summary: "Apply to a published role (public, no login required)",
        params: Type.Object({ code: Type.String() }),
        body: CareerApplyBody,
        response: { 200: CareerApplyResponse },
      },
    },
    async (request) => {
      const job = await app.jobs.find(request.params.code);
      if (!job || job.status !== "Published") {
        throw new NotFoundError("This role isn't open.");
      }
      const { resumeData, resumeMime, ...fields } = request.body;
      const created = await app.applications.create({
        ...fields,
        jobId: job.id,
        applicationCode: applicationCode(await app.applications.count()),
        source: "Careers",
        stage: "Applied",
      });
      if (resumeData && fields.resumeName) {
        await app.applications.saveResume(created.id, {
          mime: resumeMime ?? "application/octet-stream",
          data: resumeData,
        });
      }

      // Notify the applicant and the hiring team — best-effort, never blocks
      // the application from being recorded.
      const appUrl = app.config.APP_URL.replace(/\/$/, "");
      void (async () => {
        try {
          await sendApplicationReceivedEmail({
            to: created.email ?? request.body.email,
            applicantName: created.name,
            jobTitle: job.title,
            applicationCode: created.applicationCode,
            roleUrl: `${appUrl}/careers/${job.jobCode}`,
            log: app.log,
          });
        } catch (err) {
          app.log.error({ err }, "Applicant confirmation email failed");
        }
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
            await sendApplicationAlertEmail({
              to: recipients,
              applicantName: created.name,
              applicantEmail: created.email ?? request.body.email,
              jobTitle: job.title,
              applicationCode: created.applicationCode,
              boardUrl: `${appUrl}/employer/jobs/${job.jobCode}`,
              log: app.log,
            });
          }
        } catch (err) {
          app.log.error({ err }, "Hiring-team alert email failed");
        }
      })();

      return { ok: true, applicationCode: created.applicationCode };
    },
  );
};

export default careerRoutes;
