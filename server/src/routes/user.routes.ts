import { Router } from "express";
import { userController } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { auditLog } from "../middleware/audit";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);

// Las rutas de gestión de usuarios mantienen USERS_WRITE / USERS_DELETE, pero el servicio ahora
// exige rango estrictamente superior para asignar un rol o tocar a otro usuario: sin ese check,
// USERS_WRITE alcanzaba para crear un SUPER_ADMIN o resetearle la contraseña al existente.
router.get(
  "/",
  requirePermission(Permission.USERS_READ),
  userController.findAll
);
router.get(
  "/:id",
  requirePermission(Permission.USERS_READ),
  userController.findById
);
router.post(
  "/me/password",
  auditLog("USER_PASSWORD_SELF", "user"),
  userController.changeOwnPassword
);
router.post(
  "/",
  requirePermission(Permission.USERS_WRITE),
  auditLog("USER_CREATE", "user"),
  userController.create
);
router.put(
  "/:id",
  requirePermission(Permission.USERS_WRITE),
  auditLog("USER_UPDATE", "user"),
  userController.update
);
router.delete(
  "/:id",
  requirePermission(Permission.USERS_DELETE),
  auditLog("USER_DELETE", "user"),
  userController.delete
);
router.post(
  "/:id/password",
  requirePermission(Permission.USERS_WRITE),
  auditLog("USER_PASSWORD_RESET", "user"),
  userController.changePassword
);

export default router;
