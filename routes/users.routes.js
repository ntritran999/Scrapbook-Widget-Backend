import { Router } from "express";

import { requireAuth } from "../middlewares/auth.middleware.js";
import {
    getUser,
    getUsers,
    getUserGroups,
    getWidgets,
    patchUser,
    postUser,
    putWidget,
} from "../controllers/user.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", getUsers);
router.get("/:userId", getUser);
router.get("/:userId/groups", getUserGroups);
router.post("/", postUser);
router.patch("/:userId", patchUser);

router.get("/:userId/widgets", getWidgets);
router.put("/:userId/widgets/:friendId", putWidget);

export default router;
