import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { BadRequestError } from "../lib/errors";
import { hashPassword } from "../lib/password";
import type { EmployeeRepository } from "../repositories/employee.repository";
import type { PasswordResetRepository } from "../repositories/password-reset.repository";

export interface PasswordResetServiceDeps {
  employees: EmployeeRepository;
  resets: PasswordResetRepository;
  log: FastifyBaseLogger;
  appUrl: string;
  ttlMinutes: number;
  sendReset: (args: { to: string; link: string }) => Promise<void>;
}

const hashToken = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");

const isExpired = (iso: string) => new Date(iso).getTime() < Date.now();

export class PasswordResetService {
  constructor(private readonly deps: PasswordResetServiceDeps) {}

  /**
   * Always succeeds from the caller's perspective (anti-enumeration). When the
   * email matches a user, a single-use, expiring reset link is emailed.
   */
  async request(email: string): Promise<void> {
    const user = await this.deps.employees.findByEmail(email);
    if (!user) return;

    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.ttlMinutes * 60 * 1000);
    await this.deps.resets.create({
      employeeId: user.id,
      tokenHash: hashToken(raw),
      expiresAt,
    });

    const link = `${this.deps.appUrl.replace(/\/$/, "")}/reset?token=${raw}`;
    // Best-effort + anti-enumeration: never let a delivery failure surface to
    // the caller (the route always returns { sent: true }).
    try {
      await this.deps.sendReset({ to: user.email, link });
    } catch (err) {
      this.deps.log.error({ err, employeeId: user.id }, "Reset email failed to send");
    }
    this.deps.log.info({ employeeId: user.id }, "Password reset requested");
  }

  /** Throws if the token is invalid/expired/used; otherwise resolves. */
  async validate(raw: string): Promise<void> {
    await this.requireValid(raw);
  }

  async reset(input: { token: string; password: string }): Promise<void> {
    const record = await this.requireValid(input.token);
    await this.deps.employees.updatePassword(
      record.employeeId,
      await hashPassword(input.password),
    );
    await this.deps.resets.markUsed(record.id);
    this.deps.log.info({ userId: record.employeeId }, "Password reset completed");
  }

  private async requireValid(raw: string) {
    const record = await this.deps.resets.findByTokenHash(hashToken(raw));
    if (!record || record.usedAt || isExpired(record.expiresAt)) {
      throw new BadRequestError("This reset link is invalid or has expired.");
    }
    return record;
  }
}
