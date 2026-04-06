import { Router } from "express";

import { getBackgrounds } from "../controllers/background.controller.js";

import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(requireAuth);

router.get('/', getBackgrounds);

export default router;