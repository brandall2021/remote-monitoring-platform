import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/login", (req, res) => authController.login(req, res));
router.post("/refresh", (req, res) => authController.refresh(req, res));
router.post("/logout", authenticate, (req, res) => authController.logout(req, res));
router.get("/profile", authenticate, (req, res) => authController.profile(req, res));

export default router;
