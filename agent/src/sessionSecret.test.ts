import { describe, expect, it } from "vitest";
import {
  SESSION_SECRET_ENV,
  createSessionSecret,
  readSessionSecret,
  sessionSecretsMatch,
} from "./sessionSecret";

describe("createSessionSecret", () => {
  it("returns 32 random bytes as hex", () => {
    const secret = createSessionSecret();

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat between calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(createSessionSecret());

    expect(seen.size).toBe(200);
  });

  it("is not the Math.random shape it replaced", () => {
    // Math.random().toString(36) daba ~12 chars previsibles y comparables en tiempo variable.
    expect(createSessionSecret().length).toBeGreaterThan(32);
  });
});

describe("sessionSecretsMatch", () => {
  it("accepts the same secret", () => {
    const secret = createSessionSecret();

    expect(sessionSecretsMatch(secret, secret)).toBe(true);
  });

  it("rejects a different secret of the same length", () => {
    const secret = createSessionSecret();
    const other = createSessionSecret();

    expect(sessionSecretsMatch(secret, other)).toBe(false);
  });

  it("rejects empty or oversized candidates instead of comparing them", () => {
    const secret = createSessionSecret();

    expect(sessionSecretsMatch(secret, "")).toBe(false);
    expect(sessionSecretsMatch(secret, "x".repeat(513))).toBe(false);
    expect(sessionSecretsMatch("", secret)).toBe(false);
  });
});

describe("readSessionSecret", () => {
  it("reads the secret the supervisor injected in the child environment", () => {
    const secret = createSessionSecret();

    expect(readSessionSecret({ [SESSION_SECRET_ENV]: secret })).toBe(secret);
  });

  it("returns null when the variable is absent or too weak", () => {
    expect(readSessionSecret({})).toBeNull();
    expect(readSessionSecret({ [SESSION_SECRET_ENV]: "short" })).toBeNull();
    expect(readSessionSecret({ [SESSION_SECRET_ENV]: "spa ces".repeat(8) })).toBeNull();
  });

  it("tolerates the padding a scheduled task adds around the value", () => {
    const secret = createSessionSecret();

    expect(readSessionSecret({ [SESSION_SECRET_ENV]: `  ${secret}  ` })).toBe(secret);
  });
});
