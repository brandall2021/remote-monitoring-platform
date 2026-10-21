import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

import { config } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import deviceRoutes from "./routes/device.routes";
import commandRoutes from "./routes/command.routes";
import screenshotRoutes from "./routes/screenshot.routes";
import auditRoutes from "./routes/audit.routes";

// App sin listen: separar la construcción del servidor HTTP es lo que permite subirlo a un puerto
// efímero en los tests y verificar de verdad que /uploads ya no existe o que una ruta sin token
// responde 401. setupWebSocket y el listen quedan en server.ts.
export function createApp(): express.Express {
  const app = express();

  // El despliegue real tiene nginx delante (Dockerfile + docker-compose). Sin este set, Express ve
  // 127.0.0.1 en TODAS las peticiones: el limiter de login se comparte entre todos los usuarios
  // (10 intentos desde cualquier parte bloquean el login global) y req.ip de la auditoría deja de
  // servir para rastrear quién hizo qué.
  //
  // 1 salto = el proxy de este mismo contenedor. Si la topología cambia (CDN + nginx), ajustar con
  // TRUST_PROXY_HOPS; express-rate-limit rechaza `true` explícitamente porque habilita spoofing.
  app.set("trust proxy", parseInt(process.env.TRUST_PROXY_HOPS || "1", 10));
  app.disable("x-powered-by");

  app.use(
    helmet({
      // La CSP la define nginx (que sirve la SPA). Repetirla acá en el origen :3000 solo genera
      // headers duplicados; el API no renderiza HTML.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    })
  );
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
    })
  );

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
  app.use("/api/", limiter);

  // Instancias separadas: un limiter compartido entre /login y /refresh mezclaría los contadores, y
  // las recargas de página (un refresh sin cookie responde 401) terminarían bloqueando el login.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    // Solo cuentan los intentos fallidos: un usuario legítimo que entra y sale no debe agotar su
    // propia ventana de 15 minutos.
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again later" },
  });
  app.use("/api/auth/login", authLimiter);

  const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many refresh attempts, please try again later" },
  });
  app.use("/api/auth/refresh", refreshLimiter);

  // El límite de 10 MB sigue siendo el de JSON; una captura en base64 por WebSocket se cotiza
  // aparte en config.websocket.maxHttpBufferSize.
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());

  // Eliminado el antiguo:
  //   app.use("/uploads/screenshots", express.static(screenshotsDir))
  // que se montaba antes que las rutas de API y no pedía ninguna credencial. Las capturas ahora se
  // leen por GET /api/screenshots/:id/image con JWT + SCREENSHOTS_VIEW.

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/devices", deviceRoutes);
  app.use("/api/commands", commandRoutes);
  app.use("/api/screenshots", screenshotRoutes);
  app.use("/api/audit", auditRoutes);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
