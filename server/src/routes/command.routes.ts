import { Router } from "express";
import { commandController } from "../controllers/command.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(Permission.COMMANDS_READ),
  (req, res) => commandController.findAll(req, res)
);
router.get(
  "/device/:deviceId",
  requirePermission(Permission.COMMANDS_READ),
  (req, res) => commandController.findByDevice(req, res)
);
router.get(
  "/device/:deviceId/pending",
  requirePermission(Permission.COMMANDS_READ),
  (req, res) => commandController.getPending(req, res)
);
router.post(
  "/",
  requirePermission(Permission.COMMANDS_WRITE),
  (req, res) => commandController.create(req, res)
);
router.post(
  "/:id/approve",
  requirePermission(Permission.COMMANDS_EXECUTE),
  (req, res) => commandController.approve(req, res)
);
router.post(
  "/:id/reject",
  requirePermission(Permission.COMMANDS_EXECUTE),
  (req, res) => commandController.reject(req, res)
);

export default router;
