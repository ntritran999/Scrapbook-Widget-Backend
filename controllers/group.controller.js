import {
    addMemberAndWidget,
    createGroupInvitation,
    createMessage,
    createGroupWithMembers,
    createScrapbookPageAndUpdateWidgets,
    createScrapbookItem,
    refreshInviteCode,
    getGroupById,
    getItemById,
    getMemberById,
    joinGroupByInviteCode,
    listGroups,
    listMembers,
    listMessages,
    listPendingInvitationsByUser,
    listScrapbookItems,
    listScrapbookPages,
    listTodayMemoryItems,
    markMessageSeen,
    removeMemberAndWidget,
    respondToGroupInvitation,
    uploadAvatarForGroup,
    updateGroup,
    listItemReactions,
    removeReaction,
    addReaction,
    removePage
} from "../services/group.service.js";

function resolveWebSocketBaseUrl(req) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim();
    const forwardedHost = String(req.headers["x-forwarded-host"] || "")
        .split(",")[0]
        .trim();

    const protocol = forwardedProto || req.protocol || "http";
    const host = forwardedHost || req.get("host") || "localhost:3000";
    const wsProtocol = protocol === "https" ? "wss" : "ws";

    return `${wsProtocol}://${host}`;
}

function normalizeUserIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((userId) => String(userId || "").trim())
        .filter(Boolean);
}

function withTimeout(promise, timeoutMs, message = "Operation timeout") {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error(message);
                error.statusCode = 504;
                reject(error);
            }, timeoutMs);
        }),
    ]);
}

async function ensureAdminAccess(groupId, requesterId) {
    const requesterMember = await getMemberById(groupId, requesterId);
    if (!requesterMember || requesterMember.role !== "admin") {
        const error = new Error("Only admin can manage members");
        error.statusCode = 403;
        throw error;
    }
}

async function ensureMemberAccess(groupId, requesterId) {
    const requesterMember = await getMemberById(groupId, requesterId);
    if (!requesterMember) {
        const error = new Error("Only group members can add new members");
        error.statusCode = 403;
        throw error;
    }
}

export async function getGroups(req, res, next) {
    try {
        const groups = await listGroups();
        res.json(groups);
    } catch (error) {
        next(error);
    }
}

export async function getGroup(req, res, next) {
    try {
        const group = await getGroupById(req.params.groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }
        return res.json(group);
    } catch (error) {
        return next(error);
    }
}

export async function postGroup(req, res, next) {
    try {
        const ownerId = req.authUser?.uid;
        const { groupName = "", avatarUrl = "", memberIds = [] } = req.body;

        if (!ownerId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!groupName || !String(groupName).trim()) {
            return res.status(400).json({ message: "groupName is required" });
        }

        if (memberIds !== undefined && !Array.isArray(memberIds)) {
            return res.status(400).json({ message: "memberIds must be an array" });
        }

        const group = await withTimeout(
            createGroupWithMembers({
                groupName: String(groupName).trim(),
                avatarUrl: String(avatarUrl || "").trim(),
                createdBy: ownerId,
                memberIds: normalizeUserIds(memberIds),
            }),
            15000,
            "Create group request timed out"
        );

        res.status(201).json(group);
    } catch (error) {
        next(error);
    }
}

export async function patchGroupName(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;
        const { groupName } = req.body || {};

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can update group" });
        }

        if (groupName === undefined) {
            return res.status(400).json({ message: "groupName is required" });
        }

        if (!String(groupName || "").trim()) {
            return res.status(400).json({ message: "groupName cannot be empty" });
        }

        const updated = await updateGroup(groupId, {
            groupName,
        });

        return res.json(updated);
    } catch (error) {
        return next(error);
    }
}

export async function postGroupAvatar(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can update group" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "avatar file is required" });
        }

        const result = await uploadAvatarForGroup(groupId, requesterId, req.file.buffer);

        return res.status(200).json(result);
    } catch (error) {
        return next(error);
    }
}

export async function getGroupMembers(req, res, next) {
    try {
        const members = await listMembers(req.params.groupId);
        res.json(members);
    } catch (error) {
        next(error);
    }
}

export async function putGroupMember(req, res, next) {
    try {
        const { groupId, userId } = req.params;
        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        if (group.createdBy === userId) {
            return res.status(400).json({ message: "Owner is already admin" });
        }

        await ensureMemberAccess(groupId, req.authUser.uid);

        const member = await addMemberAndWidget(groupId, userId, {
            role: "member",
        });
        res.json(member);
    } catch (error) {
        next(error);
    }
}

export async function deleteGroupMember(req, res, next) {
    try {
        const { groupId, userId } = req.params;
        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        await ensureAdminAccess(groupId, req.authUser.uid);

        if (group.createdBy === userId) {
            return res.status(400).json({ message: "Cannot remove owner from group" });
        }

        const existingMember = await getMemberById(groupId, userId);
        if (!existingMember) {
            return res.status(404).json({ message: "Member not found in group" });
        }

        const result = await removeMemberAndWidget(groupId, userId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function postGroupInvitation(req, res, next) {
    try {
        const { groupId } = req.params;
        const targetUserId = String(
            req.body?.userId || req.body?.id || req.body?.invitedUserId || ""
        ).trim();
        const inviterId = req.authUser.uid;

        if (!targetUserId) {
            return res.status(400).json({ message: "userId is required" });
        }

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        await ensureMemberAccess(groupId, inviterId);

        const existingMember = await getMemberById(groupId, targetUserId);
        if (existingMember) {
            return res.status(409).json({ message: "User is already a member" });
        }

        const invitation = await createGroupInvitation(groupId, targetUserId, inviterId);
        return res.status(201).json(invitation);
    } catch (error) {
        return next(error);
    }
}

export async function getMyGroupInvitations(req, res, next) {
    try {
        const invitations = await listPendingInvitationsByUser(req.authUser.uid);
        return res.json(invitations);
    } catch (error) {
        return next(error);
    }
}

export async function postAcceptGroupInvitation(req, res, next) {
    try {
        const { groupId } = req.params;
        const myId = req.authUser.uid;

        const invitation = await respondToGroupInvitation(groupId, myId, "accepted");
        if (!invitation) {
            return res.status(404).json({ message: "Invitation not found" });
        }

        return res.json(invitation);
    } catch (error) {
        return next(error);
    }
}

export async function postDeclineGroupInvitation(req, res, next) {
    try {
        const { groupId } = req.params;
        const myId = req.authUser.uid;

        const invitation = await respondToGroupInvitation(groupId, myId, "declined");
        if (!invitation) {
            return res.status(404).json({ message: "Invitation not found" });
        }

        return res.json(invitation);
    } catch (error) {
        return next(error);
    }
}

export async function getGroupInviteLink(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can get invite link" });
        }

        const inviteCode = await refreshInviteCode(groupId);
        return res.json({
            inviteCode,
            inviteLink: `https://scrapbook-widget-bait.vercel.app/?code=${inviteCode}`,
        });
    } catch (error) {
        return next(error);
    }
}

export async function postJoinGroupByLink(req, res, next) {
    try {
        const requesterId = req.authUser?.uid;
        const inviteCode = String(req.body?.inviteCode || "").trim();

        if (!inviteCode) {
            return res.status(400).json({ message: "inviteCode is required" });
        }

        const joinedGroup = await joinGroupByInviteCode(inviteCode, requesterId);
        return res.json(joinedGroup);
    } catch (error) {
        return next(error);
    }
}

export async function leaveGroup(req, res, next) {
    try {
        const { groupId } = req.params;
        const myId = req.authUser.uid;
        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const existingMember = await getMemberById(groupId, myId);
        if (!existingMember) {
            return res.status(404).json({ message: "You are not a member of this group" });
        }

        const result = await removeMemberAndWidget(groupId, myId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function getPages(req, res, next) {
    try {
        const pages = await listScrapbookPages(req.params.groupId);
        res.json(pages);
    } catch (error) {
        next(error);
    }
}

export async function postPage(req, res, next) {
    try {
        const group = await getGroupById(req.params.groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const page = await createScrapbookPageAndUpdateWidgets(req.params.groupId, {
            ...req.body,
            createdBy: req.authUser.uid,
        });
        res.status(201).json(page);
    } catch (error) {
        next(error);
    }
}

export async function deletePage(req, res, next) {
    try {
        const group = await getGroupById(req.params.groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }
        const result = await removePage(group.id, req.params.pageId);
        res.sendStatus(204);
    } catch (error) {
        next(error);
    }
}

export async function getPageItems(req, res, next) {
    try {
        const items = await listScrapbookItems(req.params.groupId, req.params.pageId);
        res.json(items);
    } catch (error) {
        next(error);
    }
}

export async function getTodayMemory(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can access memories" });
        }

        const memories = await listTodayMemoryItems(groupId);
        return res.json(memories);
    } catch (error) {
        return next(error);
    }
}

export async function getItem(req, res, next) {
    try {
        const item = await getItemById(req.params.groupId, req.params.pageId, req.params.itemId);
        if (!item) {
            return res.status(404).json({ message: "Item not found" });
        }
        return res.json(item);
    } catch (error) {
        next(error)
    }
}

export async function postPageItem(req, res, next) {
    try {
        // Prepare payload with file data if file is uploaded
        const payload = { ...req.body };

        if (req.file) {
            // File was uploaded via multer, add it to content
            payload.content = {
                ...(payload.content || {}),
                file: req.file.buffer, // File buffer from multer
                originalName: req.file.originalname,
                mimetype: req.file.mimetype,
            };
        }

        const itemData = JSON.parse(req.body.payload);

        // Pass faceEmbeddings from request body to service
        // faceEmbeddings format: stringified JSON array of embeddings
        payload.faceEmbeddings = itemData.faceEmbeddings;

        const item = await createScrapbookItem(
            req.params.groupId,
            req.params.pageId,
            payload
        );
        res.status(201).json(item);
    } catch (error) {
        next(error);
    }
}

export async function getGroupMessages(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can access messages" });
        }

        const messages = await listMessages(groupId);
        res.json(messages);
    } catch (error) {
        next(error);
    }
}

export async function streamGroupMessages(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can access messages" });
        }

        const wsBaseUrl = resolveWebSocketBaseUrl(req);
        const wsPath = `/api/v1/groups/${encodeURIComponent(groupId)}/messages/ws`;

        return res.status(426).json({
            message: "Realtime stream moved to WebSocket",
            wsUrl: `${wsBaseUrl}${wsPath}?token=<FIREBASE_ID_TOKEN>`,
            events: [
                "stream.ready",
                "messages.initial",
                "message.created",
                "message.seen",
                "item.created",
                "scrapbook.updated",
            ],
        });
    } catch (error) {
        return next(error);
    }
}

export async function postGroupMessage(req, res, next) {
    try {
        const { groupId } = req.params;
        const requesterId = req.authUser?.uid;

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can send messages" });
        }

        const message = await createMessage(groupId, {
            ...req.body,
            createdBy: requesterId,
        });
        res.status(201).json(message);
    } catch (error) {
        next(error);
    }
}

export async function putSeenBy(req, res, next) {
    try {
        const { groupId, messageId, userId } = req.params;
        const requesterId = req.authUser?.uid;

        if (requesterId !== userId) {
            return res.status(403).json({ message: "forbidden" });
        }

        const group = await getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const requesterMember = await getMemberById(groupId, requesterId);
        if (!requesterMember) {
            return res.status(403).json({ message: "Only group members can mark message seen" });
        }

        const seenBy = await markMessageSeen(
            groupId,
            messageId,
            userId,
            req.body
        );
        res.json(seenBy);
    } catch (error) {
        next(error);
    }
}

export async function getReactions(req, res, next) {
    try {
        const reactions = await listItemReactions(req.params.groupId, req.params.pageId, req.params.itemId);
        res.json(reactions);
    } catch (error) {
        next(error);
    }
}

export async function postReaction(req, res, next) {
    try {
        const payload = {... req.body};
        const result = await addReaction(req.params.groupId, req.params.pageId, req.params.itemId, payload);
    } catch (error) {
        next(error);
    }
}

export async function deleteReaction(req, res, next) {
    try {
        const result = await removeReaction(req.params.groupId, req.params.pageId, req.params.itemId, req.params.userId);
    } catch (error) {
        next(error);
    }
}
