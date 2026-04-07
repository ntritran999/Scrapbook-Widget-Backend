import { Router } from "express";

import { requireAuth } from "../middlewares/auth.middleware.js";
import {
	deleteAccount,
	postGoogleLogin,
	postLogin,
	postRegister,
	postRegisterOtp,
	postSignout,
	postSession,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", postRegister);
router.post("/register/request-otp", postRegisterOtp);
router.post("/login", postLogin);
router.post("/session", postSession);
router.post("/google", postGoogleLogin);
router.post("/signout", requireAuth, postSignout);
router.delete("/account", requireAuth, deleteAccount);

export default router;