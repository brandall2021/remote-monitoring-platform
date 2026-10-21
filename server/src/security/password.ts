import bcrypt from "bcryptjs";
import crypto from "crypto";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Math.random() no es CSPRNG: el PRNG de V8 se recupera con unas pocas observaciones, y estos
// tokens se usaban para enlaces de restablecimiento de contraseña. randomBytes además evita el
// sesgo de módulo que tenía la versión con charAt().
export function generateToken(bytes: number = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new Error("generateToken: bytes debe estar entre 16 y 128");
  }
  return crypto.randomBytes(bytes).toString("base64url");
}

