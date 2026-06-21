import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../lib/errors";
import { hashPassword } from "../lib/password";
import type { EmployeeRepository } from "../repositories/employee.repository";
import type { ClientRepository } from "../repositories/client.repository";
import type { InviteRepository } from "../repositories/invite.repository";
import type { Invite, InvitePrefill, InviteStatus } from "../domain/invite";
import type { Employee, EmploymentType, Role } from "../domain/employee";

/** Placement + compensation an admin sets on an employee invite. */
export interface InvitePlacement {
  title?: string | null;
  employmentType?: EmploymentType | null;
  managerName?: string | null;
  billRate?: string | null;
  payRate?: string | null;
  location?: string | null;
  startDate?: string | null; // ISO date
  endDate?: string | null; // ISO date
}

export interface InviteServiceDeps {
  invites: InviteRepository;
  employees: EmployeeRepository;
  clients: ClientRepository;
  log: FastifyBaseLogger;
  appUrl: string;
  inviteTtlHours: number;
  /** Sends the invite email (or logs it in the dev fallback). */
  sendInvite: (args: {
    to: string;
    link: string;
    role: Role;
    clientName?: string | null;
    inviterName?: string | null;
  }) => Promise<void>;
}

const hashToken = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");

const isExpired = (iso: string) => new Date(iso).getTime() < Date.now();

/** Public view of an invite for the admin list (no token hash). */
export type InviteListItem = Omit<Invite, "tokenHash">;

const toListItem = ({ tokenHash: _t, ...rest }: Invite): InviteListItem => rest;

export class InviteService {
  constructor(private readonly deps: InviteServiceDeps) {}

  /**
   * Admin creates an invite. Returns the stored invite plus the magic link —
   * the raw token only exists here and in the emailed link, never in the DB.
   */
  async createInvite(input: {
    email: string;
    role: Role;
    clientId?: string | null;
    name?: string | null;
    placement?: InvitePlacement;
    invitedById?: string | null;
    inviterName?: string | null;
  }): Promise<{ invite: InviteListItem; link: string }> {
    const email = input.email.trim().toLowerCase();

    let clientName: string | null = null;
    if (input.role === "EMPLOYEE") {
      if (!input.clientId) {
        throw new BadRequestError("An employee invite requires a client.");
      }
      const client = await this.deps.clients.findById(input.clientId);
      if (!client) throw new BadRequestError("That client doesn't exist.");
      clientName = client.name;
    }

    const existing = await this.deps.employees.findByEmail(email);
    if (existing) {
      throw new ConflictError("An account with this email already exists.");
    }

    // Supersede any prior pending invite for this email.
    const prior = await this.deps.invites.findPendingByEmail(email);
    if (prior) await this.deps.invites.markRevoked(prior.id);

    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + this.deps.inviteTtlHours * 60 * 60 * 1000,
    );

    // Placement + compensation only apply to placed engineers (EMPLOYEE).
    const p = input.role === "EMPLOYEE" ? (input.placement ?? {}) : {};
    const toDate = (iso?: string | null) => (iso ? new Date(iso) : null);

    const invite = await this.deps.invites.create({
      email,
      tokenHash: hashToken(raw),
      role: input.role,
      clientId: input.role === "EMPLOYEE" ? input.clientId : null,
      name: input.name ?? null,
      title: p.title ?? null,
      employmentType: p.employmentType ?? null,
      managerName: p.managerName ?? null,
      billRate: p.billRate ?? null,
      payRate: p.payRate ?? null,
      location: p.location ?? null,
      startDate: toDate(p.startDate),
      endDate: toDate(p.endDate),
      invitedBy: input.invitedById ?? null,
      expiresAt,
    });

    const link = `${this.deps.appUrl.replace(/\/$/, "")}/onboard?token=${raw}`;

    // Email is best-effort: a delivery failure (e.g. unverified Resend domain)
    // must not fail invite creation — the admin can still copy the link.
    try {
      await this.deps.sendInvite({
        to: email,
        link,
        role: input.role,
        clientName,
        inviterName: input.inviterName ?? null,
      });
    } catch (err) {
      this.deps.log.error(
        { err, inviteId: invite.id },
        "Invite email failed to send — link still available to copy",
      );
    }

    this.deps.log.info(
      { inviteId: invite.id, role: input.role },
      "Invite created",
    );
    return { invite: toListItem(invite), link };
  }

  /** Validate a magic-link token and return data to prefill the onboarding form. */
  async getInviteByToken(raw: string): Promise<InvitePrefill> {
    const invite = await this.requireValidPending(raw);
    let clientName: string | null = null;
    if (invite.clientId) {
      const client = await this.deps.clients.findById(invite.clientId);
      clientName = client?.name ?? null;
    }
    // Split the admin-entered name (if any) to prefill the first/last fields.
    const parts = (invite.name ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = parts.length ? parts[0]! : null;
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

    return {
      email: invite.email,
      role: invite.role,
      name: invite.name,
      firstName,
      lastName,
      clientName,
    };
  }

  /**
   * Consume an invite and create the employee account. For EMPLOYEE invites
   * this also seeds a workforce profile (employee code + Onboarding status) so
   * the new hire shows up in the directory immediately.
   */
  async acceptInvite(input: {
    token: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<Employee> {
    const invite = await this.requireValidPending(input.token);

    const existing = await this.deps.employees.findByEmail(invite.email);
    if (existing) {
      throw new ConflictError("An account with this email already exists.");
    }

    const isEmployee = invite.role === "EMPLOYEE";
    const employeeCode = isEmployee
      ? `TG-${String(2000 + (await this.deps.employees.countEmployees())).padStart(4, "0")}`
      : null;

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") ||
      invite.name ||
      invite.email;

    const employee = await this.deps.employees.create({
      email: invite.email,
      name: fullName,
      firstName: firstName || null,
      lastName: lastName || null,
      role: invite.role,
      passwordHash: await hashPassword(input.password),
      clientId: invite.clientId,
      employeeCode,
      status: isEmployee ? "Onboarding" : null,
      // Carry the admin-set placement + compensation onto the new hire.
      title: invite.title,
      employmentType: invite.employmentType,
      managerName: invite.managerName,
      billRate: invite.billRate,
      payRate: invite.payRate,
      location: invite.location,
      startDate: invite.startDate ? new Date(invite.startDate) : null,
      endDate: invite.endDate ? new Date(invite.endDate) : null,
    });

    await this.deps.invites.markAccepted(invite.id);
    this.deps.log.info(
      { employeeId: employee.id, inviteId: invite.id },
      "Invite accepted — account created",
    );
    return employee;
  }

  async listInvites(filter?: {
    status?: InviteStatus;
  }): Promise<InviteListItem[]> {
    const invites = await this.deps.invites.list(filter);
    return invites.map(toListItem);
  }

  async revokeInvite(id: string): Promise<void> {
    const invite = await this.deps.invites.findById(id);
    if (!invite) throw new NotFoundError("Invite not found.");
    if (invite.status === "ACCEPTED") {
      throw new BadRequestError("That invite has already been accepted.");
    }
    await this.deps.invites.markRevoked(id);
  }

  private async requireValidPending(raw: string): Promise<Invite> {
    const invite = await this.deps.invites.findByTokenHash(hashToken(raw));
    // Use a single generic error so we never reveal which check failed.
    if (!invite || invite.status !== "PENDING" || isExpired(invite.expiresAt)) {
      throw new NotFoundError("This invite link is invalid or has expired.");
    }
    return invite;
  }
}
