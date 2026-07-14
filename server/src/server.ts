import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs/promises";

import { config } from "./config";
import prisma from "./config/database";
import { setupWebSocket } from "./websocket";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import deviceRoutes from "./routes/device.routes";
import commandRoutes from "./routes/command.routes";
import screenshotRoutes from "./routes/screenshot.routes";
import auditRoutes from "./routes/audit.routes";

async function main() {
  const app = express();
  const server = http.createServer(app);

  await fs.mkdir(config.uploads.screenshotsDir, { recursive: true });

  app.use(helmet());
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
    })
  );

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Too many requests, please try again later" },
  });
  app.use("/api/", limiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many login attempts, please try again later" },
  });
  app.use("/api/auth/login", authLimiter);

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(
    "/uploads/screenshots",
    express.static(path.resolve(config.uploads.screenshotsDir))
  );

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

  setupWebSocket(server);

  server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`WebSocket ready`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
