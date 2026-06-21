import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Tests inject an in-memory repository, so this is never connected to —
    // it only needs to be a parseable URL to satisfy env validation at import.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-test-secret-1234567890",
      LOG_LEVEL: "silent",
      // Pin MFA on so the suite exercises the full 2FA flow regardless of the
      // local .env toggle. The MFA-off path is a deployment-time config switch.
      MFA_ENABLED: "true",
    },
  },
});
