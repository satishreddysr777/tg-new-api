import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { passwordResets, type PasswordResetRow } from "../db/schema";

export interface PasswordReset {
  id: string;
  employeeId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface PasswordResetRepository {
  create(input: {
    employeeId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordReset>;
  findByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  markUsed(id: string): Promise<void>;
}

function mapRow(row: PasswordResetRow): PasswordReset {
  return {
    id: row.id,
    employeeId: row.employeeId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Supabase (Postgres) ────────────────────────────────────────────

export class DrizzlePasswordResetRepository
  implements PasswordResetRepository
{
  constructor(private readonly db: Database) {}

  async create(input: {
    employeeId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordReset> {
    const [row] = await this.db
      .insert(passwordResets)
      .values({
        employeeId: input.employeeId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error("Failed to insert password reset.");
    return mapRow(row);
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const [row] = await this.db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.tokenHash, tokenHash))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async markUsed(id: string): Promise<void> {
    await this.db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, id));
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryPasswordResetRepository
  implements PasswordResetRepository
{
  private readonly byId = new Map<string, PasswordReset>();

  async create(input: {
    employeeId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordReset> {
    const reset: PasswordReset = {
      id: randomUUID(),
      employeeId: input.employeeId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(reset.id, reset);
    return reset;
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    for (const r of this.byId.values()) {
      if (r.tokenHash === tokenHash) return r;
    }
    return null;
  }

  async markUsed(id: string): Promise<void> {
    const r = this.byId.get(id);
    if (r) r.usedAt = new Date().toISOString();
  }
}
