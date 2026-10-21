import http from "http";
import { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import { createApp } from "./app";
import { config } from "./config";
import { Role } from "./types";

// Ninguna prueba de este archivo llega a la base: se cae antes de autenticar o en el 404.
// El mock del client existe solo para que el import de las rutas no instancie PrismaClient.
jest.mock("./config/database", () => {
  const fakeModel = () =>
    new Proxy(
      {},
      {
        get: () => jest.fn(async () => null),
      }
    );

  return {
    __esModule: true,
    default: new Proxy(
      {},
      {
        get: () => fakeModel(),
      }
    ),
  };
});

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe("superficie HTTP publica", () => {
  it("no sirve capturas por /uploads (C-3)", async () => {
    const response = await fetch(`${baseUrl}/uploads/screenshots/captura.png`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("PNG");
  });

  it("no sirve el directorio de uploads ni por ruta alternativa", async () => {
    const response = await fetch(`${baseUrl}/uploads/`);

    expect(response.status).toBe(404);
  });

  it("no revela la extension de servidor", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("deja pasar el health check publico", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("ok");
  });

  it("no devuelve 404 con la ruta pedida", async () => {
    const response = await fetch(`${baseUrl}/api/noexiste?token=secreto`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(JSON.stringify(body)).not.toContain("noexiste");
  });
});

describe("gate de autenticacion", () => {
  const protectedRoutes: [string, string][] = [
    ["GET", "/api/devices"],
    ["GET", "/api/screenshots"],
    ["GET", "/api/screenshots/shot-1/image"],
    ["GET", "/api/users"],
    ["GET", "/api/audit"],
    ["GET", "/api/commands"],
  ];

  it.each(protectedRoutes)("%s %s pide credenciales", async (method, route) => {
    const response = await fetch(`${baseUrl}${route}`, { method });

    expect(response.status).toBe(401);
  });

  it("rechaza un JWT firmado con otro secreto", async () => {
    const forged = jwt.sign(
      { userId: "u-1", email: "admin@x", role: Role.SUPER_ADMIN },
      "otro-secreto-para-la-prueba",
      { expiresIn: "5m" }
    );

    const response = await fetch(`${baseUrl}/api/devices`, {
      headers: { Authorization: `Bearer ${forged}` },
    });

    expect(response.status).toBe(401);
  });

  it("no deja leer el registrationToken sin importar que role declare el token forjado", async () => {
    const forged = jwt.sign({ sub: "x" }, "otro-secreto-para-la-prueba");

    const response = await fetch(`${baseUrl}/api/devices`, {
      headers: { Authorization: `Bearer ${forged}` },
    });

    expect([401, 403]).toContain(response.status);
    expect(await response.text()).not.toContain("registrationToken");
  });
});

describe("gate de RBAC sobre rutas validadas por token", () => {
  // Mismo secreto del server: es el escenario "usuario legitimo, permiso insuficiente", el mismo
  // permiso que el canal WebSocket decidio toda la vida por su cuenta.
  const tokenFor = (role: Role) =>
    jwt.sign({ userId: "u-1", email: "u-1@x", role }, config.jwt.secret, { expiresIn: "5m" });

  const denied: [Role, string, string][] = [
    [Role.OPERATOR, "GET", "/api/users"],
    [Role.OPERATOR, "GET", "/api/users/u-2"],
    [Role.OPERATOR, "DELETE", "/api/devices/d-1"],
    [Role.OPERATOR, "DELETE", "/api/screenshots/shot-1"],
    [Role.ADMIN, "DELETE", "/api/users/u-op"],
  ];

  it.each(denied)("un %s no puede %s %s", async (role, method, route) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { Authorization: `Bearer ${tokenFor(role)}` },
    });

    expect(response.status).toBe(403);
  });

  it("un OPERATOR no puede crear comandos por HTTP", async () => {
    const response = await fetch(`${baseUrl}/api/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenFor(Role.OPERATOR)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId: "d-1", commandType: "SHUTDOWN" }),
    });

    expect(response.status).toBe(403);
  });

  it("un OPERATOR no puede cambiarse el rol a si mismo", async () => {
    const response = await fetch(`${baseUrl}/api/users/u-1`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenFor(Role.OPERATOR)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: Role.SUPER_ADMIN }),
    });

    expect(response.status).toBe(403);
  });

  it("un OPERATOR no puede pedir capturas nuevas", async () => {
    const response = await fetch(`${baseUrl}/api/screenshots/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenFor(Role.OPERATOR)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId: "d-1", reason: "prueba" }),
    });

    expect(response.status).toBe(403);
  });
});
