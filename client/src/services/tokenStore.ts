// El access token vive solo en memoria del módulo. No se escribe en localStorage ni en
// sessionStorage: un XSS ya no puede leerlo, y al recargar la página se reobtiene con el refresh
// token, que sí viaja en cookie HttpOnly (ver server/src/lib/cookies.ts).
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
}
