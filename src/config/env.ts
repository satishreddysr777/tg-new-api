import { Type, type Static } from "@sinclair/typebox";
import envSchema from "env-schema";

/**
 * Single source of truth for runtime configuration.
 * Validated at boot — the process refuses to start with an invalid env,
 * so the rest of the app can treat `config` as guaranteed-correct.
 */
const schema = Type.Object({
  NODE_ENV: Type.Union(
    [
      Type.Literal("development"),
      Type.Literal("test"),
      Type.Literal("production"),
    ],
    { default: "development" },
  ),
  HOST: Type.String({ default: "0.0.0.0" }),
  PORT: Type.Number({ default: 4000 }),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal("fatal"),
      Type.Literal("error"),
      Type.Literal("warn"),
      Type.Literal("info"),
      Type.Literal("debug"),
      Type.Literal("trace"),
      Type.Literal("silent"),
    ],
    { default: "info" },
  ),
  // Comma-separated list of allowed origins for CORS.
  CORS_ORIGINS: Type.String({ default: "http://localhost:3000" }),
  // Postgres connection string. Required — no safe default. Supplied by the
  // hosting platform's environment in production.
  DATABASE_URL: Type.String({ minLength: 1 }),
  // Max connections in the postgres-js pool.
  DB_POOL_MAX: Type.Number({ default: 10 }),
  // PEM CA certificate of a managed Postgres cluster (DigitalOcean injects
  // ${db.CA_CERT}). When set, TLS is verified against it. Empty = unchanged.
  DATABASE_CA_CERT: Type.String({ default: "" }),
  // Secret used to sign JWT access tokens. MUST be overridden in production.
  JWT_SECRET: Type.String({
    minLength: 16,
    default: "dev-only-insecure-change-me-please",
  }),
  // Access-token lifetime. Also drives the session-cookie maxAge. There is no
  // refresh token yet, so this doubles as the session length.
  JWT_ACCESS_TTL: Type.String({ default: "12h" }),
  // Cost factor for bcrypt password hashing.
  BCRYPT_ROUNDS: Type.Number({ default: 12 }),
  // Time-to-live (seconds) for a pending 2FA challenge.
  MFA_CHALLENGE_TTL_SECONDS: Type.Number({ default: 300 }),
  // Master switch for the post-login 2FA (PIN) step. Set to false to TEMP
  // bypass it — login then returns an access token directly. Defaults on.
  MFA_ENABLED: Type.Boolean({ default: true }),
  // Public origin of the web app — used to build invite / reset magic links.
  APP_URL: Type.String({ default: "http://localhost:3000" }),
  // Resend API key. When empty, emails are logged to the console (dev fallback).
  RESEND_API_KEY: Type.String({ default: "" }),
  // From-address for outbound mail.
  MAIL_FROM: Type.String({
    default: "Technograph <onboarding@technograph.io>",
  }),
  // Where new-application alerts go. When empty, falls back to ADMIN-role
  // staff emails from the database.
  HIRING_NOTIFY_EMAIL: Type.String({ default: "" }),
  // How long an onboarding invite link stays valid, in hours.
  INVITE_TTL_HOURS: Type.Number({ default: 168 }),
  // Name of the httpOnly session cookie set on login.
  SESSION_COOKIE_NAME: Type.String({ default: "tg_session" }),
});

export type AppConfig = Static<typeof schema> & {
  corsOrigins: string[];
  isProduction: boolean;
};

const raw = envSchema<Static<typeof schema>>({
  schema,
  dotenv: true,
});

export const config: AppConfig = {
  ...raw,
  corsOrigins: raw.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: raw.NODE_ENV === "production",
};

if (
  config.isProduction &&
  config.JWT_SECRET === "dev-only-insecure-change-me-please"
) {
  throw new Error(
    "JWT_SECRET must be set to a strong value in production. Refusing to start.",
  );
}
