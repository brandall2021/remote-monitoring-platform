import { Router } from "express";
import { deviceController } from "../controllers/device.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { Permission } from "../types";

const router = Router();

router.get(
  "/stats",
  authenticate,
  requirePermission(Permission.DEVICES_READ),
  (req, res) => deviceController.getStats(req, res)
);

router.get(
  "/",
  authenticate,
  requirePermission(Permission.DEVICES_READ),
  (req, res) => deviceController.findAll(req, res)
);
router.get(
  "/:id",
  authenticate,
  requirePermission(Permission.DEVICES_READ),
  (req, res) => deviceController.findById(req, res)
);
router.delete(
  "/:id",
  authenticate,
  requirePermission(Permission.DEVICES_DELETE),
  (req, res) => deviceController.delete(req, res)
);

export default router;
