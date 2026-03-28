import { Router } from "express";

import { requireAuth } from "../middlewares/auth.middleware.js";
import {
    getGroup,
    getGroupMembers,
    getGroupMessages,
    getGroups,
    getPageItems,
    getPages,
    getItem,
    postGroup,
    postGroupMessage,
    postPage,
    postPageItem,
    putGroupMember,
    putSeenBy,
} from "../controllers/group.controller.js";
import { uploadImage, handleUploadError } from "../middleware/upload.js";

const router = Router();

router.use(requireAuth);

router.get("/", getGroups);
router.get("/:groupId", getGroup);
router.post("/", postGroup);

router.get("/:groupId/members", getGroupMembers);
router.put("/:groupId/members/:userId", putGroupMember);

router.get("/:groupId/scrapbook-pages", getPages);
router.post("/:groupId/scrapbook-pages", postPage);
router.get("/:groupId/scrapbook-pages/:pageId/items", getPageItems);
router.post("/:groupId/scrapbook-pages/:pageId/items", uploadImage, handleUploadError, postPageItem);
router.get("/:groupId/scrapbook-pages/:pageId/:itemId", getItem);

router.get("/:groupId/messages", getGroupMessages);
router.post("/:groupId/messages", postGroupMessage);
router.put("/:groupId/messages/:messageId/seen-by/:userId", putSeenBy);

export default router;
