import { Router } from "express";

import { uploadImage, handleUploadError } from "../middleware/upload.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
    checkUsername,
    getUser,
    getUsersForInviteController,
    getUsers,
    getUserGroups,
    getWidgets,
    patchUser,
    postAvatar,
    postUser,
    putWidget,
    postEnrollFace,
} from "../controllers/user.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/check-username", checkUsername);
router.get("/discover", getUsersForInviteController);
router.post("/avatar", uploadImage, handleUploadError, postAvatar);

router.get("/", getUsers);
router.get("/:userId", getUser);
router.get("/:userId/groups", getUserGroups);
router.post("/", postUser);
router.patch("/:userId", patchUser);
router.post("/:userId/enroll-face", postEnrollFace);

router.get("/:userId/widgets", getWidgets);
router.put("/:userId/widgets/:friendId", putWidget);

export default router;
