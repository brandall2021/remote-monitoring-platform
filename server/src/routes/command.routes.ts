import { Router } from "express";
import { commandController } from "../controllers/command.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { auditLog } from "../middleware/audit";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(Permission.COMMANDS_READ),
  commandController.findAll
);
router.get(
  "/device/:deviceId",
  requirePermission(Permission.COMMANDS_READ),
  commandController.findByDevice
);
router.get(
  "/device/:deviceId/pending",
  requirePermission(Permission.COMMANDS_READ),
  commandController.getPending
);
// Un comando puede ser LOCK_SCREEN o SHUTDOWN: toda creación y toda aprobación quedan en el
// historial de auditoría con el usuario y la IP reales.
router.post(
  "/",
  requirePermission(Permission.COMMANDS_WRITE),
  auditLog("COMMAND_CREATE", "command"),
  commandController.create
);
router.post(
  "/:id/approve",
  requirePermission(Permission.COMMANDS_EXECUTE),
  auditLog("COMMAND_APPROVE", "command"),
  commandController.approve
);
router.post(
  "/:id/reject",
  requirePermission(Permission.COMMANDS_EXECUTE),
  auditLog("COMMAND_REJECT", "command"),
  commandController.reject
);

export default router;
