import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export interface Challenge {
  id: string;
  userId: string;
  code: string;
  method: "sms" | "email";
  hint: string;
  expiresAt: number;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

/**
 * Short-lived store for pending 2FA challenges. In-memory + TTL here; in
 * production this would be Redis so challenges survive across instances.
 */
export class ChallengeStore {
  private readonly challenges = new Map<string, Challenge>();

  constructor(private readonly ttlSeconds: number) {}

  create(input: {
    userId: string;
    method: "sms" | "email";
    hint: string;
  }): Challenge {
    const challenge: Challenge = {
      id: randomBytes(16).toString("hex"),
      userId: input.userId,
      // Zero-padded 6-digit code.
      code: randomInt(0, 1_000_000).toString().padStart(6, "0"),
      method: input.method,
      hint: input.hint,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
      attempts: 0,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  /**
   * Returns the userId on success. Returns a typed failure reason otherwise.
   * Consumes the challenge on success or when attempts are exhausted.
   */
  consume(
    id: string,
    code: string,
  ):
    | { ok: true; userId: string }
    | { ok: false; reason: "not_found" | "expired" | "locked" | "mismatch" } {
    const challenge = this.challenges.get(id);
    if (!challenge) return { ok: false, reason: "not_found" };

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(id);
      return { ok: false, reason: "expired" };
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      this.challenges.delete(id);
      return { ok: false, reason: "locked" };
    }

    challenge.attempts += 1;

    if (!safeEqual(code, challenge.code)) {
      return { ok: false, reason: "mismatch" };
    }

    this.challenges.delete(id);
    return { ok: true, userId: challenge.userId };
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
