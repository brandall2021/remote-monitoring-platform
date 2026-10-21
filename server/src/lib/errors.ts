// Los controladores venían haciendo `res.status(500).json({ error: error.message })`, así que
// cualquier excepción interna (incluido el texto de un error de Prisma o de un driver) terminaba
// en la respuesta al cliente. Con AppError se declara explícitamente qué mensaje es público.
export class AppError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly expose: boolean;

  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.name = "AppError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.expose = true;
  }
}

export const badRequest = (m = "Solicitud inválida") => new AppError(400, m);
export const unauthorized = (m = "No autenticado") => new AppError(401, m);
export const forbidden = (m = "Permisos insuficientes") => new AppError(403, m);
export const notFoundError = (m = "Recurso no encontrado") => new AppError(404, m);
export const conflict = (m = "Conflicto de datos") => new AppError(409, m);

export function asyncHandler(
  fn: (req: any, res: any, next: any) => Promise<unknown>
) {
  return (req: any, res: any, next: any): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
