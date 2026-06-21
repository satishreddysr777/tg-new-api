import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  clients,
  engagementHistory,
  invites,
  type ClientRow,
} from "../db/schema";
import type { Client } from "../domain/client";

/**
 * Client-company store. The app depends only on this interface, so the backing
 * store (Drizzle/Supabase in prod, in-memory in tests) is a swappable detail.
 */
export interface CreateClientInput {
  name: string;
  location?: string | null;
  contactEmail?: string | null;
}

/** Partial update — only the provided fields change. */
export interface UpdateClientInput {
  name?: string;
  location?: string | null;
  contactEmail?: string | null;
}

export interface ClientRepository {
  list(): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  create(input: CreateClientInput): Promise<Client>;
  update(id: string, input: UpdateClientInput): Promise<Client | null>;
  delete(id: string): Promise<void>;
}

function mapRow(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    contactEmail: row.contactEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Drizzle / Supabase (Postgres) ────────────────────────────────────────────

export class DrizzleClientRepository implements ClientRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Client[]> {
    const rows = await this.db.select().from(clients).orderBy(asc(clients.name));
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<Client | null> {
    const [row] = await this.db
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async create(input: CreateClientInput): Promise<Client> {
    const [row] = await this.db
      .insert(clients)
      .values({
        name: input.name,
        location: input.location ?? null,
        contactEmail: input.contactEmail ?? null,
      })
      .returning();
    if (!row) throw new Error("Failed to insert client.");
    return mapRow(row);
  }

  async update(id: string, input: UpdateClientInput): Promise<Client | null> {
    const patch: Partial<typeof clients.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.location !== undefined) patch.location = input.location;
    if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail;
    if (Object.keys(patch).length === 0) return this.findById(id);

    const [row] = await this.db
      .update(clients)
      .set(patch)
      .where(eq(clients.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async delete(id: string): Promise<void> {
    // Historical invites + engagement records FK into clients; detach them so
    // the row can be removed. The client name is already snapshotted on the
    // engagement history, so its record survives. Callers must verify no
    // employees are assigned before calling this.
    await this.db
      .update(invites)
      .set({ clientId: null })
      .where(eq(invites.clientId, id));
    await this.db
      .update(engagementHistory)
      .set({ clientId: null })
      .where(eq(engagementHistory.clientId, id));
    await this.db.delete(clients).where(eq(clients.id, id));
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryClientRepository implements ClientRepository {
  private readonly byId = new Map<string, Client>();

  async list(): Promise<Client[]> {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<Client | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateClientInput): Promise<Client> {
    const client: Client = {
      id: randomUUID(),
      name: input.name,
      location: input.location ?? null,
      contactEmail: input.contactEmail ?? null,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(client.id, client);
    return client;
  }

  async update(id: string, input: UpdateClientInput): Promise<Client | null> {
    const client = this.byId.get(id);
    if (!client) return null;
    if (input.name !== undefined) client.name = input.name;
    if (input.location !== undefined) client.location = input.location;
    if (input.contactEmail !== undefined) client.contactEmail = input.contactEmail;
    return client;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}
