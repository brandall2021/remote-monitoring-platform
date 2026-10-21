import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { auditLog } from "../middleware/audit";

const router = Router();

router.post("/login", authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authenticate, auditLog("LOGOUT", "auth"), authController.logout);
router.get("/profile", authenticate, authController.profile);

export default router;
