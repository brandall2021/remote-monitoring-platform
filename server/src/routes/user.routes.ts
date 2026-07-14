import { Router } from "express";
import { userController } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(Permission.USERS_READ),
  (req, res) => userController.findAll(req, res)
);
router.get(
  "/:id",
  requirePermission(Permission.USERS_READ),
  (req, res) => userController.findById(req, res)
);
router.post(
  "/",
  requirePermission(Permission.USERS_WRITE),
  (req, res) => userController.create(req, res)
);
router.put(
  "/:id",
  requirePermission(Permission.USERS_WRITE),
  (req, res) => userController.update(req, res)
);
router.delete(
  "/:id",
  requirePermission(Permission.USERS_DELETE),
  (req, res) => userController.delete(req, res)
);
router.post(
  "/:id/password",
  requirePermission(Permission.USERS_WRITE),
  (req, res) => userController.changePassword(req, res)
);

export default router;
