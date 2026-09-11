import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { engagementHistory, type EngagementHistoryRow } from "../db/schema";
import type { EngagementHistory } from "../domain/engagement";

/**
 * Append-only store of ended placements. The app depends only on this
 * interface, so the backing store (Drizzle/Postgres in prod, in-memory in
 * tests) is a swappable detail.
 */
export interface CreateEngagementHistoryInput {
  employeeId: string;
  clientId?: string | null;
  clientName: string;
  title?: string | null;
  startDate?: Date | null;
  endDate: Date;
  billRate?: string | null;
  payRate?: string | null;
  reason?: string | null;
}

export interface EngagementHistoryRepository {
  create(input: CreateEngagementHistoryInput): Promise<EngagementHistory>;
  /** Ended engagements for an employee, newest first. */
  listByEmployee(employeeId: string): Promise<EngagementHistory[]>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function mapRow(row: EngagementHistoryRow): EngagementHistory {
  return {
    id: row.id,
    employeeId: row.employeeId,
    clientId: row.clientId,
    clientName: row.clientName,
    title: row.title,
    startDate: iso(row.startDate),
    endDate: row.endDate.toISOString(),
    billRate: row.billRate,
    payRate: row.payRate,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Postgres ────────────────────────────────────────────

export class DrizzleEngagementHistoryRepository
  implements EngagementHistoryRepository
{
  constructor(private readonly db: Database) {}

  async create(
    input: CreateEngagementHistoryInput,
  ): Promise<EngagementHistory> {
    const [row] = await this.db
      .insert(engagementHistory)
      .values({
        employeeId: input.employeeId,
        clientId: input.clientId ?? null,
        clientName: input.clientName,
        title: input.title ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate,
        billRate: input.billRate ?? null,
        payRate: input.payRate ?? null,
        reason: input.reason ?? null,
      })
      .returning();
    if (!row) throw new Error("Failed to insert engagement history.");
    return mapRow(row);
  }

  async listByEmployee(employeeId: string): Promise<EngagementHistory[]> {
    const rows = await this.db
      .select()
      .from(engagementHistory)
      .where(eq(engagementHistory.employeeId, employeeId))
      .orderBy(desc(engagementHistory.endDate));
    return rows.map(mapRow);
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryEngagementHistoryRepository
  implements EngagementHistoryRepository
{
  private readonly byId = new Map<string, EngagementHistory>();

  async create(
    input: CreateEngagementHistoryInput,
  ): Promise<EngagementHistory> {
    const entry: EngagementHistory = {
      id: randomUUID(),
      employeeId: input.employeeId,
      clientId: input.clientId ?? null,
      clientName: input.clientName,
      title: input.title ?? null,
      startDate: input.startDate ? input.startDate.toISOString() : null,
      endDate: input.endDate.toISOString(),
      billRate: input.billRate ?? null,
      payRate: input.payRate ?? null,
      reason: input.reason ?? null,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(entry.id, entry);
    return entry;
  }

  async listByEmployee(employeeId: string): Promise<EngagementHistory[]> {
    return [...this.byId.values()]
      .filter((e) => e.employeeId === employeeId)
      .sort((a, b) => b.endDate.localeCompare(a.endDate));
  }
}
