import { Router } from "express";

import authRouter from "./auth.routes.js";
import groupsRouter from "./groups.routes.js";
import templatesRouter from "./templates.routes.js";
import usersRouter from "./users.routes.js";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/groups", groupsRouter);
router.use("/templates", templatesRouter);

export default router;
