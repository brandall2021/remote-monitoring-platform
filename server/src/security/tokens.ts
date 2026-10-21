import crypto from "crypto";

// Comparación en tiempo constante para secretos (token de onboarding y token por dispositivo).
// `a !== b` de strings en V8 sale ante el primer byte distinto: con suficientes mediciones se puede
// reconstruir el token byte a byte. Se comparan digestos SHA-256 para que además la longitud no
// sea observable.
export function safeCompare(a: string, b: string): boolean {
  // Falla cerrado: dos vacios "coinciden" como digests, y un secreto vacio en la config no tiene
  // que equivaler a un atacante que manda el header sin token.
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;

  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// El refresh token vive 7 dias y se persiste para poder rotarlo y revocarlo. Guardarlo en claro
// significa que un read de la base (o un dump, o alguien con acceso al panel de Dokploy) exporta
// sesiones valideas de una semana sin need de romper JWT. Con el digesto SHA-256 la tabla sigue
// sirviendo como allowlist de tokens activos, pero filtrarla ya no da credenciales.
//
// No se usa bcrypt aqui: la comparacion es por lookup indexado (`token = hash`), no por challenge
// interactivo, asi que hace falta determinismo y un solo paso criptografico.
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
