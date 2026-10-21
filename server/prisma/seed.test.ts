import { describe, expect, it } from "@jest/globals";
import bcrypt from "bcryptjs";
import { SEED_ADMIN_EMAIL, SeedClient, resolveInitialPassword, runSeed } from "./seed";

// C-1: el seed se corría en el CMD del contenedor y hacia upsert del admin con el hash de
// "admin123" en cada arranque. Cualquier rotación de contraseña se deshacia con un restart.
type CreatedArgs = { data: Record<string, unknown>; select?: unknown };
type UpdatedArgs = { where: Record<string, unknown>; data: Record<string, unknown> };

function fakeClient(options: { existing?: { id: string; email: string } | null }): {
  client: SeedClient;
  created: CreatedArgs[];
  updated: UpdatedArgs[];
} {
  const created: CreatedArgs[] = [];
  const updated: UpdatedArgs[] = [];
  let existing = options.existing ?? null;

  const client: SeedClient = {
    role: {
      upsert: async () => ({ id: "role-super-admin" }),
    },
    user: {
      findUnique: async () => existing,
      update: async (args) => {
        updated.push(args as UpdatedArgs);
        return {};
      },
      create: async (args) => {
        const typed = args as CreatedArgs;
        created.push(typed);
        existing = { id: "user-new", email: String(typed.data.email) };
        return { id: "user-new", email: String(typed.data.email) };
      },
    },
  };

  return { client, created, updated };
}

const silent = () => undefined;

describe("runSeed", () => {
  it("leaves the password of an existing admin untouched", async () => {
    const { client, updated, created } = fakeClient({
      existing: { id: "user-1", email: SEED_ADMIN_EMAIL },
    });

    const outcome = await runSeed(client, {}, silent);

    expect(outcome).toBe("reconciled");
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(Object.keys(updated[0].data)).not.toContain("passwordHash");
    expect(updated[0].data).toMatchObject({ username: "admin", firstName: "System" });
  });

  it("is idempotent: a second pass never recreates the user", async () => {
    const { client, created } = fakeClient({ existing: null });

    await runSeed(client, { SEED_ADMIN_PASSWORD: "una-clave-larga-1" }, silent);
    await runSeed(client, { SEED_ADMIN_PASSWORD: "una-clave-larga-1" }, silent);

    expect(created).toHaveLength(1);
  });

  it("does not seed the public admin123 hash", async () => {
    const { client, created } = fakeClient({ existing: null });

    await runSeed(client, {}, silent);

    const passwordHash = String(created[0].data.passwordHash);
    expect(created).toHaveLength(1);
    expect(await bcrypt.compare("admin123", passwordHash)).toBe(false);
    expect(created[0].data.email).toBe(SEED_ADMIN_EMAIL);
  });

  it("never prints an explicit SEED_ADMIN_PASSWORD", async () => {
    const lines: string[] = [];
    const { client } = fakeClient({ existing: null });

    await runSeed(client, { SEED_ADMIN_PASSWORD: "una-clave-larga-1" }, (line) => lines.push(line));

    expect(lines.join("\n")).not.toContain("una-clave-larga-1");
  });

  it("prints the generated password exactly once, on first creation", async () => {
    const lines: string[] = [];
    const { client, created } = fakeClient({ existing: null });

    await runSeed(client, {}, (line) => lines.push(line));

    expect(lines.filter((line) => line.includes("CONTRASEÑA INICIAL"))).toHaveLength(1);

    const passwordHash = String(created[0].data.passwordHash);
    // Buscamos la linea que valida, no la posicion: el orden del log no es parte del contrato.
    const candidates = lines.filter((line) => line.length >= 12 && !line.includes(" "));
    const matches = await Promise.all(candidates.map((line) => bcrypt.compare(line, passwordHash)));
    const printed = candidates[matches.indexOf(true)];

    expect(printed).toBeDefined();
    expect(await bcrypt.compare(printed, passwordHash)).toBe(true);
  });
});

describe("resolveInitialPassword", () => {
  it("generates a random password when none is configured", () => {
    const first = resolveInitialPassword({});
    const second = resolveInitialPassword({});

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(12);
  });

  it("accepts a configured password of at least 12 characters", () => {
    expect(resolveInitialPassword({ SEED_ADMIN_PASSWORD: "doccia-larga-ok" })).toBe(
      "doccia-larga-ok"
    );
  });

  it("rejects a weak configured password instead of silently using it", () => {
    expect(() => resolveInitialPassword({ SEED_ADMIN_PASSWORD: "corta" })).toThrow(/12/);
  });

  it("treats an empty value as 'not configured'", () => {
    expect(resolveInitialPassword({ SEED_ADMIN_PASSWORD: "" })).not.toBe("");
  });
});
