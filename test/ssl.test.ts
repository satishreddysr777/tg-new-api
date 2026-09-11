import { describe, expect, it } from "vitest";
import { sslOptions } from "../src/db/ssl";

describe("sslOptions", () => {
  it("returns undefined when no CA cert is configured", () => {
    expect(sslOptions(undefined)).toBeUndefined();
    expect(sslOptions("")).toBeUndefined();
    expect(sslOptions("   \n")).toBeUndefined();
  });

  it("returns verified TLS options when a CA cert is given", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";
    expect(sslOptions(pem)).toEqual({ ca: pem.trim(), rejectUnauthorized: true });
  });
});
