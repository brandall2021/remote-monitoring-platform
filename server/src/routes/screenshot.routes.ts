import { Router } from "express";
import { screenshotController } from "../controllers/screenshot.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { auditLog } from "../middleware/audit";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  screenshotController.findAll
);
router.get(
  "/device/:deviceId",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  screenshotController.findByDevice
);
router.get(
  "/:id",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  screenshotController.findById
);
// El binario de la captura se sirve solo por acá. Antes existía /uploads/screenshots como
// express.static público montado antes que todas las rutas de API.
router.get(
  "/:id/image",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  screenshotController.image
);
router.post(
  "/request",
  requirePermission(Permission.SCREENSHOTS_REQUEST),
  auditLog("SCREENSHOT_REQUEST", "screenshot"),
  screenshotController.request
);
router.delete(
  "/:id",
  requirePermission(Permission.SCREENSHOTS_REQUEST),
  auditLog("SCREENSHOT_DELETE", "screenshot"),
  screenshotController.delete
);

export default router;
