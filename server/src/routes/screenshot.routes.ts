import { Router } from "express";
import { screenshotController } from "../controllers/screenshot.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  (req, res) => screenshotController.findAll(req, res)
);
router.get(
  "/device/:deviceId",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  (req, res) => screenshotController.findByDevice(req, res)
);
router.get(
  "/:id",
  requirePermission(Permission.SCREENSHOTS_VIEW),
  (req, res) => screenshotController.findById(req, res)
);
router.post(
  "/request",
  requirePermission(Permission.SCREENSHOTS_REQUEST),
  (req, res) => screenshotController.request(req, res)
);
router.delete(
  "/:id",
  requirePermission(Permission.SCREENSHOTS_REQUEST),
  (req, res) => screenshotController.delete(req, res)
);

export default router;
