import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

const isProduction = (process.env.NODE_ENV || "development") === "production";

// Valores que estaban hardcodeados en el repo público: si siguen vigentes, el server firma tokens
// con una clave que conoce cualquiera. Se tratan como "no provisto", no como default usable.
const PLACEHOLDERS = new Set([
  "change-this",
  "change-this-jwt-secret-in-production",
  "change-this-refresh-secret",
  "change-this-agent-token",
  "secret",
  "changeme",
]);

// En producción el proceso muere si falta el secreto: mejor un deploy que no arranca que uno que
// arranca inseguro. En desarrollo se genera un secreto efímero por proceso (los tokens no sobreviven
// a un restart, pero tampoco se firman con una clave pública del repo).
function resolveSecret(name: string, label: string): string {
  const raw = process.env[name];
  if (!raw || PLACEHOLDERS.has(raw)) {
    if (isProduction) {
      throw new Error(
        `${name} no está definido (o tiene un valor de ejemplo). ` +
          `Generá uno con: openssl rand -hex 32`
      );
    }
    const ephemeral = crypto.randomBytes(32).toString("hex");
    console.warn(
      `[config] ${name} ausente: usando secreto efímero solo para desarrollo (${label}).`
    );
    return ephemeral;
  }
  // Un secreto corto es brute-forceable por diccionario sobre el HMAC de JWT.
  if (raw.length < 16) {
    throw new Error(`${name} debe tener al menos 16 caracteres.`);
  }
  return raw;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction,
  database: {
    url: process.env.DATABASE_URL!,
  },
  jwt: {
    secret: resolveSecret("JWT_SECRET", "access token"),
    refreshSecret: resolveSecret("JWT_REFRESH_SECRET", "refresh token"),
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  },
  agent: {
    registrationToken: resolveSecret("AGENT_REGISTRATION_TOKEN", "onboarding de agentes"),
  },
  uploads: {
    screenshotsDir: process.env.SCREENSHOTS_DIR || "./uploads/screenshots",
    // Cota dura sobre lo que un agente puede subir por frame: sin esto, un agente comprometido
    // llena el disco del server. 12 MB cubre holgadamente un PNG 4K.
    maxScreenshotBytes: parseInt(process.env.MAX_SCREENSHOT_BYTES || String(12 * 1024 * 1024), 10),
  },
  websocket: {
    // socket.io venía con el default de 1 MB por mensaje: los frames JPEG del live view de una
    // pantalla grande lo pasan y se truncaban. Es también la cota de memoria por conexión.
    maxHttpBufferSize: parseInt(process.env.WS_MAX_BUFFER_BYTES || String(16 * 1024 * 1024), 10),
    pingIntervalMs: parseInt(process.env.WS_PING_INTERVAL_MS || "10000", 10),
    pingTimeoutMs: parseInt(process.env.WS_PING_TIMEOUT_MS || "5000", 10),
    // Caducidad del estado de "online": el agente reporta heartbeat cada 30 s, así que 3 latidos
    // perdidos recién deberían marcar el equipo como apagado.
    offlineAfterMs: parseInt(process.env.DEVICE_OFFLINE_AFTER_MS || String(3 * 60 * 1000), 10),
  },
  cookies: {
    // Nombre de la cookie donde el server guarda el refresh token. HttpOnly: el JS del navegador
    // no puede leerla, así que un XSS ya no exporta la sesión de 7 días.
    refreshName: process.env.REFRESH_COOKIE_NAME || "rm_refresh",
    secure:
      process.env.COOKIE_SECURE === "true" ||
      (isProduction && process.env.COOKIE_SECURE !== "false"),
    sameSite: (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax",
  },
};
