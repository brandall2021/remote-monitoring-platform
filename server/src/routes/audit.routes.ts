import { Router } from "express";
import { auditController } from "../controllers/audit.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { Permission } from "../types";

const router = Router();

router.use(authenticate);
router.use(requirePermission(Permission.AUDIT_READ));

router.get("/", (req, res) => auditController.findAll(req, res));

export default router;
