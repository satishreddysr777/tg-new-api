import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  applicationResumes,
  applications,
  clients,
  jobs,
  type ApplicationRow,
} from "../db/schema";
import type {
  Application,
  ApplicationExperience,
  ApplicationStage,
  ApplicationWithJob,
} from "../domain/application";

export interface CreateApplicationInput {
  applicationCode: string;
  jobId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  source?: string | null;
  years?: number | null;
  compAsk?: string | null;
  matchPct?: number | null;
  stage: ApplicationStage;
  summary?: string | null;
  skills?: string[];
  linkedin?: string | null;
  resumeName?: string | null;
  experience?: ApplicationExperience[];
}

export interface ResumeFile {
  mime: string;
  data: string; // base64
}

export interface ApplicationRepository {
  create(input: CreateApplicationInput): Promise<Application>;
  count(): Promise<number>;
  listByJob(jobId: string): Promise<Application[]>;
  /** The signed-in employee's own applications, joined with their job. */
  listByApplicantEmail(email: string): Promise<ApplicationWithJob[]>;
  find(idOrCode: string): Promise<Application | null>;
  updateStage(id: string, stage: ApplicationStage): Promise<Application>;
  /** Store (or replace) the résumé bytes for an application. */
  saveResume(applicationId: string, file: ResumeFile): Promise<void>;
  getResume(applicationId: string): Promise<ResumeFile | null>;
}

function mapRow(row: ApplicationRow): Application {
  return {
    id: row.id,
    applicationCode: row.applicationCode,
    jobId: row.jobId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    source: row.source,
    years: row.years,
    compAsk: row.compAsk,
    matchPct: row.matchPct,
    stage: row.stage as ApplicationStage,
    summary: row.summary,
    skills: row.skills,
    linkedin: row.linkedin,
    resumeName: row.resumeName,
    experience: row.experience,
    appliedAt: row.appliedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Supabase (Postgres) ────────────────────────────────────────────

export class DrizzleApplicationRepository implements ApplicationRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateApplicationInput): Promise<Application> {
    const [row] = await this.db
      .insert(applications)
      .values({
        applicationCode: input.applicationCode,
        jobId: input.jobId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        location: input.location ?? null,
        source: input.source ?? null,
        years: input.years ?? null,
        compAsk: input.compAsk ?? null,
        matchPct: input.matchPct ?? null,
        stage: input.stage,
        summary: input.summary ?? null,
        skills: input.skills ?? [],
        linkedin: input.linkedin ?? null,
        resumeName: input.resumeName ?? null,
        experience: input.experience ?? [],
      })
      .returning();
    if (!row) throw new Error("Failed to insert application.");
    return mapRow(row);
  }

  async count(): Promise<number> {
    const rows = await this.db
      .select({ id: applications.id })
      .from(applications);
    return rows.length;
  }

  async listByJob(jobId: string): Promise<Application[]> {
    const rows = await this.db
      .select()
      .from(applications)
      .where(eq(applications.jobId, jobId))
      .orderBy(asc(applications.appliedAt));
    return rows.map(mapRow);
  }

  async listByApplicantEmail(email: string): Promise<ApplicationWithJob[]> {
    const rows = await this.db
      .select({
        app: applications,
        jobTitle: jobs.title,
        jobCode: jobs.jobCode,
        jobClientName: clients.name,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(eq(applications.email, email.trim().toLowerCase()))
      .orderBy(desc(applications.appliedAt));
    return rows.map((r) => ({
      ...mapRow(r.app),
      jobTitle: r.jobTitle,
      jobCode: r.jobCode,
      jobClientName: r.jobClientName,
    }));
  }

  async find(idOrCode: string): Promise<Application | null> {
    const predicate = idOrCode.startsWith("A-")
      ? eq(applications.applicationCode, idOrCode)
      : eq(applications.id, idOrCode);
    const [row] = await this.db
      .select()
      .from(applications)
      .where(predicate)
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async updateStage(
    id: string,
    stage: ApplicationStage,
  ): Promise<Application> {
    const [row] = await this.db
      .update(applications)
      .set({ stage })
      .where(eq(applications.id, id))
      .returning();
    if (!row) throw new Error("Application not found.");
    return mapRow(row);
  }

  async saveResume(applicationId: string, file: ResumeFile): Promise<void> {
    await this.db
      .insert(applicationResumes)
      .values({ applicationId, mime: file.mime, data: file.data })
      .onConflictDoUpdate({
        target: applicationResumes.applicationId,
        set: { mime: file.mime, data: file.data },
      });
  }

  async getResume(applicationId: string): Promise<ResumeFile | null> {
    const [row] = await this.db
      .select({ mime: applicationResumes.mime, data: applicationResumes.data })
      .from(applicationResumes)
      .where(eq(applicationResumes.applicationId, applicationId))
      .limit(1);
    return row ? { mime: row.mime, data: row.data } : null;
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryApplicationRepository implements ApplicationRepository {
  private readonly byId = new Map<string, Application>();
  private readonly resumes = new Map<string, ResumeFile>();
  private readonly jobInfo = new Map<
    string,
    { title: string; jobCode: string; clientName: string | null }
  >();

  /** Test helper: register a job so the applicant join resolves. */
  registerJob(
    jobId: string,
    info: { title: string; jobCode: string; clientName: string | null },
  ): void {
    this.jobInfo.set(jobId, info);
  }

  async create(input: CreateApplicationInput): Promise<Application> {
    const now = new Date().toISOString();
    const app: Application = {
      id: randomUUID(),
      applicationCode: input.applicationCode,
      jobId: input.jobId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      location: input.location ?? null,
      source: input.source ?? null,
      years: input.years ?? null,
      compAsk: input.compAsk ?? null,
      matchPct: input.matchPct ?? null,
      stage: input.stage,
      summary: input.summary ?? null,
      skills: input.skills ?? [],
      linkedin: input.linkedin ?? null,
      resumeName: input.resumeName ?? null,
      experience: input.experience ?? [],
      appliedAt: now,
      createdAt: now,
    };
    this.byId.set(app.id, app);
    return app;
  }

  async count(): Promise<number> {
    return this.byId.size;
  }

  async listByJob(jobId: string): Promise<Application[]> {
    return [...this.byId.values()]
      .filter((a) => a.jobId === jobId)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  }

  async listByApplicantEmail(email: string): Promise<ApplicationWithJob[]> {
    const target = email.trim().toLowerCase();
    return [...this.byId.values()]
      .filter((a) => (a.email ?? "").trim().toLowerCase() === target)
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
      .map((a) => {
        const info = this.jobInfo.get(a.jobId);
        return {
          ...a,
          jobTitle: info?.title ?? "—",
          jobCode: info?.jobCode ?? "—",
          jobClientName: info?.clientName ?? null,
        };
      });
  }

  async find(idOrCode: string): Promise<Application | null> {
    return (
      [...this.byId.values()].find((a) =>
        idOrCode.startsWith("A-")
          ? a.applicationCode === idOrCode
          : a.id === idOrCode,
      ) ?? null
    );
  }

  async updateStage(
    id: string,
    stage: ApplicationStage,
  ): Promise<Application> {
    const a = this.byId.get(id);
    if (!a) throw new Error("Application not found.");
    a.stage = stage;
    return a;
  }

  async saveResume(applicationId: string, file: ResumeFile): Promise<void> {
    this.resumes.set(applicationId, file);
  }

  async getResume(applicationId: string): Promise<ResumeFile | null> {
    return this.resumes.get(applicationId) ?? null;
  }
}
