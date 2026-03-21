import { Router } from "express";

import {
    getUser,
    getUsers,
    getWidgets,
    patchUser,
    postUser,
    putWidget,
} from "../controllers/user.controller.js";

const router = Router();

router.get("/", getUsers);
router.get("/:userId", getUser);
router.post("/", postUser);
router.patch("/:userId", patchUser);

router.get("/:userId/widgets", getWidgets);
router.put("/:userId/widgets/:friendId", putWidget);

export default router;
