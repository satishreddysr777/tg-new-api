import type { FastifyReply } from "fastify";
import { config } from "../config/env";

/** Parse a short TTL string ("15m", "12h", "7d") into seconds. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

const MAX_AGE_SECONDS = ttlToSeconds(config.JWT_ACCESS_TTL);

/** Set the httpOnly session cookie that carries the access token. */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" });
}
