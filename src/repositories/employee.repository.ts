import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  clients,
  employees,
  engagementHistory,
  invites,
  passwordResets,
  type EmployeeRow,
} from "../db/schema";
import {
  toPublicEmployee,
  type Employee,
  type EmployeeStatus,
  type EmployeeWithClient,
  type EmploymentType,
  type Role,
} from "../domain/employee";

/**
 * Everything reads/writes through this one store: identity + auth lookups AND
 * the workforce directory. The backing store (Drizzle/Supabase in prod,
 * in-memory in tests) is a swappable detail.
 */
export interface CreateEmployeeInput {
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  role: Role;
  passwordHash: string;
  clientId?: string | null;
  employeeCode?: string | null;
  title?: string | null;
  employmentType?: EmploymentType | null;
  status?: EmployeeStatus | null;
  billRate?: string | null;
  payRate?: string | null;
  managerName?: string | null;
  location?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  stack?: string[];
}

/** Fields a new hire fills in on their own during onboarding. */
export interface OnboardingInput {
  name: string;
  phoneHint: string;
  location: string;
  stack: string[];
  status: EmployeeStatus;
}

export interface EmployeeRepository {
  // identity + auth
  findByEmail(email: string): Promise<Employee | null>;
  findById(id: string): Promise<Employee | null>;
  create(input: CreateEmployeeInput): Promise<Employee>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  setClientId(id: string, clientId: string | null): Promise<void>;
  /** New hire self-updates their profile and marks onboarding complete. */
  completeOnboarding(id: string, input: OnboardingInput): Promise<Employee>;
  /** End the current placement: go On bench, unassign client, stamp end date. */
  endEngagement(id: string, input: { endDate: Date }): Promise<Employee>;
  /** Permanently remove an employee (and their dependent records). */
  delete(id: string): Promise<void>;
  // internal staff (ADMIN/EMPLOYER) who can manage placed engineers
  listManagers(): Promise<Employee[]>;
  // workforce directory (role = EMPLOYEE), joined with client name
  listDirectory(): Promise<EmployeeWithClient[]>;
  findDirectory(idOrCode: string): Promise<EmployeeWithClient | null>;
  countEmployees(): Promise<number>;
  /** Number of placed engineers per client id (clients with none are absent). */
  employeeCountsByClient(): Promise<Record<string, number>>;
}

const normalize = (email: string) => email.trim().toLowerCase();
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function mapRow(row: EmployeeRow): Employee {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    passwordHash: row.passwordHash,
    phoneHint: row.phoneHint,
    clientId: row.clientId,
    employeeCode: row.employeeCode,
    title: row.title,
    employmentType: row.employmentType,
    status: row.status,
    billRate: row.billRate,
    payRate: row.payRate,
    managerName: row.managerName,
    location: row.location,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
    stack: row.stack,
    createdAt: row.createdAt.toISOString(),
  };
}

const withClient = (
  e: Employee,
  clientName: string | null,
): EmployeeWithClient => ({ ...toPublicEmployee(e), clientName });

// ── Drizzle / Supabase (Postgres) ────────────────────────────────────────────

export class DrizzleEmployeeRepository implements EmployeeRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string): Promise<Employee | null> {
    const [row] = await this.db
      .select()
      .from(employees)
      .where(eq(employees.email, normalize(email)))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<Employee | null> {
    const [row] = await this.db
      .select()
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async create(input: CreateEmployeeInput): Promise<Employee> {
    const [row] = await this.db
      .insert(employees)
      .values({
        email: normalize(input.email),
        name: input.name,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        role: input.role,
        passwordHash: input.passwordHash,
        clientId: input.clientId ?? null,
        employeeCode: input.employeeCode ?? null,
        title: input.title ?? null,
        employmentType: input.employmentType ?? null,
        status: input.status ?? null,
        billRate: input.billRate ?? null,
        payRate: input.payRate ?? null,
        managerName: input.managerName ?? null,
        location: input.location ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        stack: input.stack ?? [],
      })
      .returning();
    if (!row) throw new Error("Failed to insert employee.");
    return mapRow(row);
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(employees)
      .set({ passwordHash })
      .where(eq(employees.id, id));
  }

  async setClientId(id: string, clientId: string | null): Promise<void> {
    await this.db.update(employees).set({ clientId }).where(eq(employees.id, id));
  }

  async completeOnboarding(
    id: string,
    input: OnboardingInput,
  ): Promise<Employee> {
    const [row] = await this.db
      .update(employees)
      .set({
        name: input.name,
        phoneHint: input.phoneHint,
        location: input.location,
        stack: input.stack,
        status: input.status,
      })
      .where(eq(employees.id, id))
      .returning();
    if (!row) throw new Error("Employee not found.");
    return mapRow(row);
  }

  async endEngagement(
    id: string,
    input: { endDate: Date },
  ): Promise<Employee> {
    const [row] = await this.db
      .update(employees)
      .set({ status: "On bench", clientId: null, endDate: input.endDate })
      .where(eq(employees.id, id))
      .returning();
    if (!row) throw new Error("Employee not found.");
    return mapRow(row);
  }

  async delete(id: string): Promise<void> {
    // Preserve placement history — detach it from the employee rather than
    // deleting it, so the record of who worked where survives the removal.
    await this.db
      .update(engagementHistory)
      .set({ employeeId: null })
      .where(eq(engagementHistory.employeeId, id));
    // Clear the remaining rows that FK into employees.
    await this.db
      .delete(passwordResets)
      .where(eq(passwordResets.employeeId, id));
    await this.db
      .update(invites)
      .set({ invitedBy: null })
      .where(eq(invites.invitedBy, id));
    await this.db.delete(employees).where(eq(employees.id, id));
  }

  private directorySelect() {
    return this.db
      .select({ emp: employees, clientName: clients.name })
      .from(employees)
      .leftJoin(clients, eq(employees.clientId, clients.id));
  }

  async listManagers(): Promise<Employee[]> {
    const rows = await this.db
      .select()
      .from(employees)
      .where(inArray(employees.role, ["ADMIN", "EMPLOYER"]))
      .orderBy(asc(employees.name));
    return rows.map(mapRow);
  }

  async listDirectory(): Promise<EmployeeWithClient[]> {
    const rows = await this.directorySelect()
      .where(eq(employees.role, "EMPLOYEE"))
      .orderBy(asc(employees.name));
    return rows.map((r) => withClient(mapRow(r.emp), r.clientName));
  }

  async findDirectory(idOrCode: string): Promise<EmployeeWithClient | null> {
    const predicate = idOrCode.startsWith("TG-")
      ? eq(employees.employeeCode, idOrCode)
      : eq(employees.id, idOrCode);
    const [row] = await this.directorySelect().where(predicate).limit(1);
    return row ? withClient(mapRow(row.emp), row.clientName) : null;
  }

  async countEmployees(): Promise<number> {
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.role, "EMPLOYEE"));
    return rows.length;
  }

  async employeeCountsByClient(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ clientId: employees.clientId })
      .from(employees)
      .where(eq(employees.role, "EMPLOYEE"));
    const counts: Record<string, number> = {};
    for (const { clientId } of rows) {
      if (clientId) counts[clientId] = (counts[clientId] ?? 0) + 1;
    }
    return counts;
  }
}

// ── In-memory (tests / local prototyping) ────────────────────────────────────

export class InMemoryEmployeeRepository implements EmployeeRepository {
  private readonly byId = new Map<string, Employee>();
  private readonly idByEmail = new Map<string, string>();
  private readonly clientNames = new Map<string, string>();

  /** Test helper: register a client name so the directory join resolves. */
  registerClient(id: string, name: string): void {
    this.clientNames.set(id, name);
  }

  async findByEmail(email: string): Promise<Employee | null> {
    const id = this.idByEmail.get(normalize(email));
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<Employee | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateEmployeeInput): Promise<Employee> {
    const employee: Employee = {
      id: randomUUID(),
      email: normalize(input.email),
      name: input.name,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      role: input.role,
      passwordHash: input.passwordHash,
      phoneHint: "···· ·· 0163",
      clientId: input.clientId ?? null,
      employeeCode: input.employeeCode ?? null,
      title: input.title ?? null,
      employmentType: input.employmentType ?? null,
      status: input.status ?? null,
      billRate: input.billRate ?? null,
      payRate: input.payRate ?? null,
      managerName: input.managerName ?? null,
      location: input.location ?? null,
      startDate: input.startDate ? input.startDate.toISOString() : null,
      endDate: input.endDate ? input.endDate.toISOString() : null,
      stack: input.stack ?? [],
      createdAt: new Date().toISOString(),
    };
    this.byId.set(employee.id, employee);
    this.idByEmail.set(employee.email, employee.id);
    return employee;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    const e = this.byId.get(id);
    if (e) e.passwordHash = passwordHash;
  }

  async setClientId(id: string, clientId: string | null): Promise<void> {
    const e = this.byId.get(id);
    if (e) e.clientId = clientId;
  }

  async completeOnboarding(
    id: string,
    input: OnboardingInput,
  ): Promise<Employee> {
    const e = this.byId.get(id);
    if (!e) throw new Error("Employee not found.");
    e.name = input.name;
    e.phoneHint = input.phoneHint;
    e.location = input.location;
    e.stack = input.stack;
    e.status = input.status;
    return e;
  }

  async endEngagement(
    id: string,
    input: { endDate: Date },
  ): Promise<Employee> {
    const e = this.byId.get(id);
    if (!e) throw new Error("Employee not found.");
    e.status = "On bench";
    e.clientId = null;
    e.endDate = input.endDate.toISOString();
    return e;
  }

  async delete(id: string): Promise<void> {
    const e = this.byId.get(id);
    if (!e) return;
    this.byId.delete(id);
    this.idByEmail.delete(e.email);
  }

  async listManagers(): Promise<Employee[]> {
    return [...this.byId.values()]
      .filter((e) => e.role === "ADMIN" || e.role === "EMPLOYER")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listDirectory(): Promise<EmployeeWithClient[]> {
    return [...this.byId.values()]
      .filter((e) => e.role === "EMPLOYEE")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) =>
        withClient(e, e.clientId ? (this.clientNames.get(e.clientId) ?? null) : null),
      );
  }

  async findDirectory(idOrCode: string): Promise<EmployeeWithClient | null> {
    const e = [...this.byId.values()].find((x) =>
      idOrCode.startsWith("TG-") ? x.employeeCode === idOrCode : x.id === idOrCode,
    );
    return e
      ? withClient(e, e.clientId ? (this.clientNames.get(e.clientId) ?? null) : null)
      : null;
  }

  async countEmployees(): Promise<number> {
    return [...this.byId.values()].filter((e) => e.role === "EMPLOYEE").length;
  }

  async employeeCountsByClient(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const e of this.byId.values()) {
      if (e.role === "EMPLOYEE" && e.clientId) {
        counts[e.clientId] = (counts[e.clientId] ?? 0) + 1;
      }
    }
    return counts;
  }
}
