import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { contactMessages, type ContactMessageRow } from "../db/schema";
import type {
  ContactMessage,
  ContactStatus,
} from "../domain/contact-message";

/**
 * Contact-message store. The public form writes here; staff read and triage in
 * the Employer Console. As with the other repos, the backing store is a
 * swappable detail (Drizzle/Postgres in prod, in-memory in tests).
 */
export interface CreateContactMessageInput {
  intent?: string | null;
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  message?: string | null;
}

export interface ContactMessageRepository {
  list(): Promise<ContactMessage[]>;
  findById(id: string): Promise<ContactMessage | null>;
  create(input: CreateContactMessageInput): Promise<ContactMessage>;
  updateStatus(
    id: string,
    status: ContactStatus,
  ): Promise<ContactMessage | null>;
  delete(id: string): Promise<void>;
  countNew(): Promise<number>;
}

function mapRow(row: ContactMessageRow): ContactMessage {
  return {
    id: row.id,
    intent: row.intent,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Postgres ────────────────────────────────────────────

export class DrizzleContactMessageRepository
  implements ContactMessageRepository
{
  constructor(private readonly db: Database) {}

  async list(): Promise<ContactMessage[]> {
    const rows = await this.db
      .select()
      .from(contactMessages)
      .orderBy(desc(contactMessages.createdAt));
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<ContactMessage | null> {
    const [row] = await this.db
      .select()
      .from(contactMessages)
      .where(eq(contactMessages.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async create(input: CreateContactMessageInput): Promise<ContactMessage> {
    const [row] = await this.db
      .insert(contactMessages)
      .values({
        intent: input.intent ?? null,
        name: input.name,
        email: input.email,
        company: input.company ?? null,
        phone: input.phone ?? null,
        message: input.message ?? null,
      })
      .returning();
    if (!row) throw new Error("Failed to insert contact message.");
    return mapRow(row);
  }

  async updateStatus(
    id: string,
    status: ContactStatus,
  ): Promise<ContactMessage | null> {
    const [row] = await this.db
      .update(contactMessages)
      .set({ status })
      .where(eq(contactMessages.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(contactMessages).where(eq(contactMessages.id, id));
  }

  async countNew(): Promise<number> {
    const rows = await this.db
      .select({ id: contactMessages.id })
      .from(contactMessages)
      .where(eq(contactMessages.status, "NEW"));
    return rows.length;
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryContactMessageRepository
  implements ContactMessageRepository
{
  private readonly byId = new Map<string, ContactMessage>();

  async list(): Promise<ContactMessage[]> {
    return [...this.byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async findById(id: string): Promise<ContactMessage | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateContactMessageInput): Promise<ContactMessage> {
    const msg: ContactMessage = {
      id: randomUUID(),
      intent: input.intent ?? null,
      name: input.name,
      email: input.email,
      company: input.company ?? null,
      phone: input.phone ?? null,
      message: input.message ?? null,
      status: "NEW",
      createdAt: new Date().toISOString(),
    };
    this.byId.set(msg.id, msg);
    return msg;
  }

  async updateStatus(
    id: string,
    status: ContactStatus,
  ): Promise<ContactMessage | null> {
    const msg = this.byId.get(id);
    if (!msg) return null;
    msg.status = status;
    return msg;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }

  async countNew(): Promise<number> {
    return [...this.byId.values()].filter((m) => m.status === "NEW").length;
  }
}
