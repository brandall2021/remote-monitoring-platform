import { createHash, randomBytes, timingSafeEqual } from "crypto";

// Secreto efimero del par supervisor/worker: vive solo en la RAM del supervisor y en el bloque de
// entorno del proceso que ese supervisor levanta. Se renueva en cada arranque, asi que robarlo de
// un log o de un volcado viejo no sirve para conectar a la pipe de la sesion actual.
export const SESSION_SECRET_ENV = "RM_SESSION_SECRET";

const SECRET_BYTES = 32;
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;

export function createSessionSecret(): string {
  return randomBytes(SECRET_BYTES).toString("hex");
}

// Digest + timingSafeEqual: compara en tiempo constante aunque largo y contenido difieran, y evita
// que un "no coincide" a la primera byte sirva para adivinar el secreto por temporizacion.
export function sessionSecretsMatch(expected: string, candidate: string): boolean {
  if (
    typeof expected !== "string" ||
    typeof candidate !== "string" ||
    expected.length === 0 ||
    candidate.length === 0 ||
    candidate.length > MAX_SECRET_LENGTH
  ) {
    return false;
  }

  return timingSafeEqual(
    createHash("sha256").update(expected, "utf8").digest(),
    createHash("sha256").update(candidate, "utf8").digest()
  );
}

export function readSessionSecret(
  env: Record<string, string | undefined> = process.env
): string | null {
  const raw = env[SESSION_SECRET_ENV];
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (value.length < MIN_SECRET_LENGTH || value.length > MAX_SECRET_LENGTH) return null;
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) return null;

  return value;
}
