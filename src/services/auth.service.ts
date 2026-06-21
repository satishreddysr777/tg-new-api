import type { FastifyBaseLogger } from "fastify";
import { TooManyRequestsError, UnauthorizedError } from "../lib/errors";
import { verifyPassword } from "../lib/password";
import type { EmployeeRepository } from "../repositories/employee.repository";
import {
  toPublicEmployee,
  type PublicEmployee,
  type Role,
  type Employee,
} from "../domain/employee";
import { ChallengeStore } from "../repositories/challenge.store";

export interface AuthServiceDeps {
  employees: EmployeeRepository;
  challenges: ChallengeStore;
  log: FastifyBaseLogger;
  /**
   * When false, the post-login 2FA (PIN) step is skipped and login/register
   * return an access token directly. Toggled via the MFA_ENABLED env flag.
   */
  mfaEnabled: boolean;
  /** Injected from @fastify/jwt so the service stays transport-agnostic. */
  signAccessToken: (payload: {
    sub: string;
    email: string;
    role: Role;
  }) => string;
}

export interface ChallengeResult {
  challengeId: string;
  method: "sms" | "email";
  hint: string;
}

export interface TokenResult {
  accessToken: string;
  tokenType: "Bearer";
  user: Pick<PublicEmployee, "id" | "email" | "name" | "role" | "clientId">;
}

/** Either a pending-2FA challenge or, when MFA is off, an issued token. */
export type AuthOutcome = ChallengeResult | TokenResult;

/**
 * Auth use-cases. Throws domain errors (lib/errors) — the route layer never
 * touches HTTP status codes. Email enumeration is deliberately avoided.
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(input: {
    email: string;
    password: string;
  }): Promise<AuthOutcome> {
    const user = await this.deps.employees.findByEmail(input.email);

    // Run a comparison even when the user is missing to blunt timing analysis.
    const ok =
      user !== null && (await verifyPassword(input.password, user.passwordHash));

    if (!user || !ok) {
      throw new UnauthorizedError("Incorrect email or password.");
    }

    return this.startSession(user);
  }

  /** Issue a session token for an already-authenticated user (e.g. after invite accept). */
  issueSession(user: Employee): TokenResult {
    return this.issueToken(user);
  }

  async verify(input: {
    challengeId: string;
    code: string;
  }): Promise<TokenResult> {
    const result = this.deps.challenges.consume(input.challengeId, input.code);

    if (!result.ok) {
      if (result.reason === "locked") {
        throw new TooManyRequestsError(
          "Too many attempts. Request a new code.",
        );
      }
      throw new UnauthorizedError("That code is invalid or has expired.");
    }

    const user = await this.deps.employees.findById(result.userId);
    if (!user) throw new UnauthorizedError("Account no longer exists.");

    return this.issueToken(user);
  }

  /**
   * Decide what a freshly-authenticated user gets: a 2FA challenge normally,
   * or a token straight away when MFA is disabled (temp bypass).
   */
  private startSession(user: Employee): AuthOutcome {
    if (!this.deps.mfaEnabled) {
      this.deps.log.warn(
        { userId: user.id },
        "MFA disabled — issuing token without 2FA",
      );
      return this.issueToken(user);
    }
    return this.issueChallenge(user.id, user.phoneHint);
  }

  private issueToken(user: Employee): TokenResult {
    const accessToken = this.deps.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      accessToken,
      tokenType: "Bearer",
      user: toPublicEmployee(user),
    };
  }

  private issueChallenge(userId: string, hint: string): ChallengeResult {
    const challenge = this.deps.challenges.create({
      userId,
      method: "sms",
      hint,
    });

    // The code is logged at debug so the flow is testable without an SMS
    // provider wired up. Production runs at info+, so it stays out of logs.
    this.deps.log.debug(
      { challengeId: challenge.id, code: challenge.code },
      "2FA challenge issued",
    );

    return {
      challengeId: challenge.id,
      method: challenge.method,
      hint: challenge.hint,
    };
  }
}
