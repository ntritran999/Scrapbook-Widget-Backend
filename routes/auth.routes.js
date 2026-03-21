import { Router } from "express";

import { postLogin, postRegister } from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", postRegister);
router.post("/login", postLogin);

export default router;