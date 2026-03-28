import { Router } from "express";

import { requireAuth } from "../middlewares/auth.middleware.js";
import {
	deleteAccount,
	postLogin,
	postRegister,
	postSignout,
	postSession,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", postRegister);
router.post("/login", postLogin);
router.post("/session", postSession);
router.post("/signout", requireAuth, postSignout);
router.delete("/account", requireAuth, deleteAccount);

export default router;