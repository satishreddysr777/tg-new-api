import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { clients, jobs, type JobRow } from "../db/schema";
import type { Job, JobStatus, JobWithClient } from "../domain/job";

export interface CreateJobInput {
  jobCode: string;
  title: string;
  clientId?: string | null;
  hiringManager?: string | null;
  department?: string | null;
  engagementType?: string | null;
  location?: string | null;
  headcount?: number;
  compType?: string | null;
  compMin?: string | null;
  compMax?: string | null;
  stack?: string[];
  summary?: string | null;
  responsibilities?: string | null;
  status: JobStatus;
}

export interface UpdateJobInput {
  title?: string;
  clientId?: string | null;
  hiringManager?: string | null;
  department?: string | null;
  engagementType?: string | null;
  location?: string | null;
  headcount?: number;
  compType?: string | null;
  compMin?: string | null;
  compMax?: string | null;
  stack?: string[];
  summary?: string | null;
  responsibilities?: string | null;
  status?: JobStatus;
}

export interface JobRepository {
  create(input: CreateJobInput): Promise<Job>;
  update(id: string, input: UpdateJobInput): Promise<Job | null>;
  count(): Promise<number>;
  listWithClient(): Promise<JobWithClient[]>;
  /** Published jobs only — for the public careers board. */
  listPublished(): Promise<Job[]>;
  /** Look up a single job by UUID or job code (JOB-####). */
  find(idOrCode: string): Promise<JobWithClient | null>;
}

function mapRow(row: JobRow): Job {
  return {
    id: row.id,
    jobCode: row.jobCode,
    title: row.title,
    clientId: row.clientId,
    hiringManager: row.hiringManager,
    department: row.department,
    engagementType: row.engagementType,
    location: row.location,
    headcount: row.headcount,
    compType: row.compType,
    compMin: row.compMin,
    compMax: row.compMax,
    stack: row.stack,
    summary: row.summary,
    responsibilities: row.responsibilities,
    status: row.status as JobStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Supabase (Postgres) ────────────────────────────────────────────

export class DrizzleJobRepository implements JobRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateJobInput): Promise<Job> {
    const [row] = await this.db
      .insert(jobs)
      .values({
        jobCode: input.jobCode,
        title: input.title,
        clientId: input.clientId ?? null,
        hiringManager: input.hiringManager ?? null,
        department: input.department ?? null,
        engagementType: input.engagementType ?? null,
        location: input.location ?? null,
        headcount: input.headcount ?? 1,
        compType: input.compType ?? null,
        compMin: input.compMin ?? null,
        compMax: input.compMax ?? null,
        stack: input.stack ?? [],
        summary: input.summary ?? null,
        responsibilities: input.responsibilities ?? null,
        status: input.status,
      })
      .returning();
    if (!row) throw new Error("Failed to insert job.");
    return mapRow(row);
  }

  async update(id: string, input: UpdateJobInput): Promise<Job | null> {
    const patch: Partial<typeof jobs.$inferInsert> = {};
    for (const key of [
      "title",
      "clientId",
      "hiringManager",
      "department",
      "engagementType",
      "location",
      "headcount",
      "compType",
      "compMin",
      "compMax",
      "stack",
      "summary",
      "responsibilities",
      "status",
    ] as const) {
      if (input[key] !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (patch as any)[key] = input[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db
        .select()
        .from(jobs)
        .where(eq(jobs.id, id))
        .limit(1);
      return row ? mapRow(row) : null;
    }
    const [row] = await this.db
      .update(jobs)
      .set(patch)
      .where(eq(jobs.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async count(): Promise<number> {
    const rows = await this.db.select({ id: jobs.id }).from(jobs);
    return rows.length;
  }

  async listWithClient(): Promise<JobWithClient[]> {
    const rows = await this.db
      .select({ job: jobs, clientName: clients.name })
      .from(jobs)
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .orderBy(desc(jobs.createdAt));
    return rows.map((r) => ({ ...mapRow(r.job), clientName: r.clientName }));
  }

  async listPublished(): Promise<Job[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.status, "Published"))
      .orderBy(desc(jobs.createdAt));
    return rows.map(mapRow);
  }

  async find(idOrCode: string): Promise<JobWithClient | null> {
    const predicate = idOrCode.startsWith("JOB-")
      ? eq(jobs.jobCode, idOrCode)
      : eq(jobs.id, idOrCode);
    const [row] = await this.db
      .select({ job: jobs, clientName: clients.name })
      .from(jobs)
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(predicate)
      .limit(1);
    return row ? { ...mapRow(row.job), clientName: row.clientName } : null;
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryJobRepository implements JobRepository {
  private readonly byId = new Map<string, Job>();
  private readonly clientNames = new Map<string, string>();

  /** Test helper: register a client name so the listing join resolves. */
  registerClient(id: string, name: string): void {
    this.clientNames.set(id, name);
  }

  async create(input: CreateJobInput): Promise<Job> {
    const job: Job = {
      id: randomUUID(),
      jobCode: input.jobCode,
      title: input.title,
      clientId: input.clientId ?? null,
      hiringManager: input.hiringManager ?? null,
      department: input.department ?? null,
      engagementType: input.engagementType ?? null,
      location: input.location ?? null,
      headcount: input.headcount ?? 1,
      compType: input.compType ?? null,
      compMin: input.compMin ?? null,
      compMax: input.compMax ?? null,
      stack: input.stack ?? [],
      summary: input.summary ?? null,
      responsibilities: input.responsibilities ?? null,
      status: input.status,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(job.id, job);
    return job;
  }

  async update(id: string, input: UpdateJobInput): Promise<Job | null> {
    const j = this.byId.get(id);
    if (!j) return null;
    if (input.title !== undefined) j.title = input.title;
    if (input.clientId !== undefined) j.clientId = input.clientId;
    if (input.hiringManager !== undefined) j.hiringManager = input.hiringManager;
    if (input.department !== undefined) j.department = input.department;
    if (input.engagementType !== undefined)
      j.engagementType = input.engagementType;
    if (input.location !== undefined) j.location = input.location;
    if (input.headcount !== undefined) j.headcount = input.headcount;
    if (input.compType !== undefined) j.compType = input.compType;
    if (input.compMin !== undefined) j.compMin = input.compMin;
    if (input.compMax !== undefined) j.compMax = input.compMax;
    if (input.stack !== undefined) j.stack = input.stack;
    if (input.summary !== undefined) j.summary = input.summary;
    if (input.responsibilities !== undefined)
      j.responsibilities = input.responsibilities;
    if (input.status !== undefined) j.status = input.status;
    return j;
  }

  async count(): Promise<number> {
    return this.byId.size;
  }

  async listWithClient(): Promise<JobWithClient[]> {
    return [...this.byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => ({
        ...j,
        clientName: j.clientId
          ? (this.clientNames.get(j.clientId) ?? null)
          : null,
      }));
  }

  async listPublished(): Promise<Job[]> {
    return [...this.byId.values()]
      .filter((j) => j.status === "Published")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async find(idOrCode: string): Promise<JobWithClient | null> {
    const j = [...this.byId.values()].find((x) =>
      idOrCode.startsWith("JOB-") ? x.jobCode === idOrCode : x.id === idOrCode,
    );
    return j
      ? {
          ...j,
          clientName: j.clientId
            ? (this.clientNames.get(j.clientId) ?? null)
            : null,
        }
      : null;
  }
}
