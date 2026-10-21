// Ninguna lista puede aceptar un `limit` arbitrario del query: con ?limit=1000000 el server
// materializa toda la tabla en memoria y se cae.
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export function parsePagination(query: Record<string, unknown>): {
  page: number;
  limit: number;
  skip: number;
} {
  const rawPage = parseInt(String(query.page ?? "1"), 10);
  const rawLimit = parseInt(String(query.limit ?? String(DEFAULT_PAGE_SIZE)), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, limit, skip: (page - 1) * limit };
}
