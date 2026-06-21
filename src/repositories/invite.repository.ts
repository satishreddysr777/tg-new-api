import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { invites, type InviteRow } from "../db/schema";
import type { Invite, InviteStatus } from "../domain/invite";
import type { EmploymentType, Role } from "../domain/employee";

export interface CreateInviteInput {
  email: string;
  tokenHash: string;
  role: Role;
  clientId?: string | null;
  name?: string | null;
  // Placement + compensation set by the admin (employee invites only).
  title?: string | null;
  employmentType?: EmploymentType | null;
  managerName?: string | null;
  billRate?: string | null;
  payRate?: string | null;
  location?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  invitedBy?: string | null;
  expiresAt: Date;
}

export interface InviteRepository {
  create(input: CreateInviteInput): Promise<Invite>;
  findById(id: string): Promise<Invite | null>;
  findByTokenHash(tokenHash: string): Promise<Invite | null>;
  findPendingByEmail(email: string): Promise<Invite | null>;
  list(filter?: { status?: InviteStatus }): Promise<Invite[]>;
  markAccepted(id: string): Promise<void>;
  markRevoked(id: string): Promise<void>;
}

const normalize = (email: string) => email.trim().toLowerCase();

function mapRow(row: InviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    tokenHash: row.tokenHash,
    role: row.role,
    clientId: row.clientId,
    name: row.name,
    title: row.title,
    employmentType: row.employmentType,
    managerName: row.managerName,
    billRate: row.billRate,
    payRate: row.payRate,
    location: row.location,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    invitedBy: row.invitedBy,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Supabase (Postgres) ────────────────────────────────────────────

export class DrizzleInviteRepository implements InviteRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateInviteInput): Promise<Invite> {
    const [row] = await this.db
      .insert(invites)
      .values({
        email: normalize(input.email),
        tokenHash: input.tokenHash,
        role: input.role,
        clientId: input.clientId ?? null,
        name: input.name ?? null,
        title: input.title ?? null,
        employmentType: input.employmentType ?? null,
        managerName: input.managerName ?? null,
        billRate: input.billRate ?? null,
        payRate: input.payRate ?? null,
        location: input.location ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        invitedBy: input.invitedBy ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error("Failed to insert invite.");
    return mapRow(row);
  }

  async findById(id: string): Promise<Invite | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(eq(invites.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Invite | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async findPendingByEmail(email: string): Promise<Invite | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(
        and(eq(invites.email, normalize(email)), eq(invites.status, "PENDING")),
      )
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async list(filter?: { status?: InviteStatus }): Promise<Invite[]> {
    const rows = await this.db
      .select()
      .from(invites)
      .where(filter?.status ? eq(invites.status, filter.status) : undefined)
      .orderBy(desc(invites.createdAt));
    return rows.map(mapRow);
  }

  async markAccepted(id: string): Promise<void> {
    await this.db
      .update(invites)
      .set({ status: "ACCEPTED", acceptedAt: new Date() })
      .where(eq(invites.id, id));
  }

  async markRevoked(id: string): Promise<void> {
    await this.db
      .update(invites)
      .set({ status: "REVOKED" })
      .where(eq(invites.id, id));
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryInviteRepository implements InviteRepository {
  private readonly byId = new Map<string, Invite>();

  async create(input: CreateInviteInput): Promise<Invite> {
    const invite: Invite = {
      id: randomUUID(),
      email: normalize(input.email),
      tokenHash: input.tokenHash,
      role: input.role,
      clientId: input.clientId ?? null,
      name: input.name ?? null,
      title: input.title ?? null,
      employmentType: input.employmentType ?? null,
      managerName: input.managerName ?? null,
      billRate: input.billRate ?? null,
      payRate: input.payRate ?? null,
      location: input.location ?? null,
      startDate: input.startDate ? input.startDate.toISOString() : null,
      endDate: input.endDate ? input.endDate.toISOString() : null,
      invitedBy: input.invitedBy ?? null,
      status: "PENDING",
      expiresAt: input.expiresAt.toISOString(),
      acceptedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(invite.id, invite);
    return invite;
  }

  async findById(id: string): Promise<Invite | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<Invite | null> {
    for (const inv of this.byId.values()) {
      if (inv.tokenHash === tokenHash) return inv;
    }
    return null;
  }

  async findPendingByEmail(email: string): Promise<Invite | null> {
    const e = normalize(email);
    for (const inv of this.byId.values()) {
      if (inv.email === e && inv.status === "PENDING") return inv;
    }
    return null;
  }

  async list(filter?: { status?: InviteStatus }): Promise<Invite[]> {
    return [...this.byId.values()]
      .filter((i) => (filter?.status ? i.status === filter.status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markAccepted(id: string): Promise<void> {
    const inv = this.byId.get(id);
    if (inv) {
      inv.status = "ACCEPTED";
      inv.acceptedAt = new Date().toISOString();
    }
  }

  async markRevoked(id: string): Promise<void> {
    const inv = this.byId.get(id);
    if (inv) inv.status = "REVOKED";
  }
}
