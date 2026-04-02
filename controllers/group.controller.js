import {
    addMemberAndWidget,
    createGroupInvitation,
    createMessage,
    createGroupWithMembers,
    createScrapbookPageAndUpdateWidgets,
    createScrapbookItem,
    getGroupById,
    getItemById,
    getMemberById,
    listGroups,
    listMembers,
    listMessages,
    listPendingInvitationsByUser,
    listScrapbookItems,
    listScrapbookPages,
    markMessageSeen,
    removeMemberAndWidget,
    respondToGroupInvitation,
    uploadAvatarForGroup,
    updateGroup,
    listItemReactions,
    removeReaction,
    addReaction
} from "../services/group.service.js";
import {
    sendSseEvent,
    subscribeToGroupMessages,
} from "../services/messageRealtime.service.js";

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

export async function getPageItems(req, res, next) {
    try {
        const items = await listScrapbookItems(req.params.groupId, req.params.pageId);
        res.json(items);
    } catch (error) {
        next(error);
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
        const messages = await listMessages(req.params.groupId);
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

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        if (typeof res.flushHeaders === "function") {
            res.flushHeaders();
        }

        const unsubscribe = subscribeToGroupMessages(groupId, res);
        const initialMessages = await listMessages(groupId);
        sendSseEvent(res, "messages.initial", initialMessages);

        const heartbeat = setInterval(() => {
            res.write(": heartbeat\n\n");
        }, 25000);

        req.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    } catch (error) {
        return next(error);
    }
}

export async function postGroupMessage(req, res, next) {
    try {
        const message = await createMessage(req.params.groupId, req.body);
        res.status(201).json(message);
    } catch (error) {
        next(error);
    }
}

export async function putSeenBy(req, res, next) {
    try {
        const seenBy = await markMessageSeen(
            req.params.groupId,
            req.params.messageId,
            req.params.userId,
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