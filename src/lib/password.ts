import bcrypt from "bcryptjs";
import { config } from "../config/env";

/** Hash a plaintext password using bcrypt with the configured cost factor. */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, config.BCRYPT_ROUNDS);
}

/** Constant-time comparison of a plaintext password against a stored hash. */
export function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
