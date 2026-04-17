import { Router } from "express";

import { requireAuth } from "../middlewares/auth.middleware.js";
import {
    deleteGroupMember,
    getGroup,
    getGroupInviteLink,
    getMyGroupInvitations,
    getGroupMembers,
    getGroupMessages,
    getGroups,
    getPageItems,
    getPages,
    getItem,
    getTodayMemory,
    getReactions,
    postReaction,
    deleteReaction,
    leaveGroup,
    patchGroupName,
    postGroupAvatar,
    postAcceptGroupInvitation,
    postDeclineGroupInvitation,
    postGroup,
    postGroupInvitation,
    postJoinGroupByLink,
    postGroupMessage,
    postPage,
    postPageItem,
    streamGroupMessages,
    putGroupMember,
    putSeenBy,
    deletePage,
} from "../controllers/group.controller.js";
import { uploadImage, handleUploadError } from "../middleware/upload.js";

const router = Router();

router.use(requireAuth);

router.get("/", getGroups);
router.post("/join-by-link", postJoinGroupByLink);
router.get("/invitations/me", getMyGroupInvitations);
router.get("/:groupId", getGroup);
router.get("/:groupId/invite-link", getGroupInviteLink);
router.post("/", postGroup);
router.patch("/:groupId/name", patchGroupName);
router.post("/:groupId/avatar", uploadImage, handleUploadError, postGroupAvatar);
router.get("/:groupId/today-memory", getTodayMemory);

router.get("/:groupId/members", getGroupMembers);
router.put("/:groupId/members/:userId", putGroupMember);
router.delete("/:groupId/members/:userId", deleteGroupMember);
router.post("/:groupId/leave", leaveGroup);
router.post("/:groupId/invitations", postGroupInvitation);
router.post("/:groupId/invitations/accept", postAcceptGroupInvitation);
router.post("/:groupId/invitations/decline", postDeclineGroupInvitation);

router.get("/:groupId/scrapbook-pages", getPages);
router.post("/:groupId/scrapbook-pages", postPage);
router.delete("/:groupId/scrapbook-pages/:pageId", deletePage);
router.get("/:groupId/scrapbook-pages/:pageId/items", getPageItems);
router.post("/:groupId/scrapbook-pages/:pageId/items", uploadImage, handleUploadError, postPageItem);
router.get("/:groupId/scrapbook-pages/:pageId/:itemId", getItem);
router.get("/:groupId/scrapbook-pages/:pageId/:itemId/reactions", getReactions);
router.post("/:groupId/scrapbook-pages/:pageId/:itemId/reactions", postReaction);
router.delete("/:groupId/scrapbook-pages/:pageId/:itemId/:userId", deleteReaction);

router.get("/:groupId/messages", getGroupMessages);
router.get("/:groupId/messages/ws", streamGroupMessages);
router.get("/:groupId/messages/stream", streamGroupMessages);
router.post("/:groupId/messages", postGroupMessage);
router.put("/:groupId/messages/:messageId/seen-by/:userId", putSeenBy);

export default router;
