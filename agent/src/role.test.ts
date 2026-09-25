import { describe, expect, it } from "vitest";
import { resolveRole } from "./role";

describe("resolveRole", () => {
  it("defaults to standalone when nothing is provided", () => {
    expect(resolveRole([], {})).toBe("standalone");
  });

  it("reads the role from the --role argument", () => {
    expect(resolveRole(["--role=supervisor"], {})).toBe("supervisor");
    expect(resolveRole(["--role", "session"], {})).toBe("session");
  });

  it("reads the role from the environment", () => {
    expect(resolveRole([], { RM_AGENT_ROLE: "supervisor" })).toBe("supervisor");
  });

  it("prefers the argument over the environment", () => {
    expect(resolveRole(["--role=session"], { RM_AGENT_ROLE: "supervisor" })).toBe("session");
  });

  it("ignores unknown roles", () => {
    expect(resolveRole(["--role=root"], {})).toBe("standalone");
    expect(resolveRole(["--role"], {})).toBe("standalone");
    expect(resolveRole([], { RM_AGENT_ROLE: "root" })).toBe("standalone");
  });

  it("ignores unrelated arguments", () => {
    expect(resolveRole(["node", "dist/agent.js", "--verbose"], {})).toBe("standalone");
  });
});
