import { Router } from "express";
import rateLimit from "express-rate-limit";
import { deviceController } from "../controllers/device.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { auditLog } from "../middleware/audit";
import { Permission } from "../types";

const router = Router();

// El register solo conoce el token de onboarding como secreto: sin límite, se puede atacar por
// fuerza bruta desde cualquier host con el mismo peso que un login.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts" },
});

router.post("/register", registerLimiter, (req, res, next) =>
  deviceController.register(req, res, next)
);

router.get(
  "/stats",
  authenticate,
  requirePermission(Permission.DEVICES_READ),
  deviceController.getStats
);

router.get(
  "/",
  authenticate,
  requirePermission(Permission.DEVICES_READ),
  deviceController.findAll
);
router.get(
  "/:id",
  authenticate,
  requirePermission(Permission.DEVICES_READ),
  deviceController.findById
);
router.put(
  "/:id",
  authenticate,
  requirePermission(Permission.DEVICES_WRITE),
  auditLog("DEVICE_UPDATE", "device"),
  deviceController.update
);
router.delete(
  "/:id",
  authenticate,
  requirePermission(Permission.DEVICES_DELETE),
  auditLog("DEVICE_DELETE", "device"),
  deviceController.delete
);

export default router;
