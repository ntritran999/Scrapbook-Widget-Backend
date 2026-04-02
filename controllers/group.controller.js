import {
    addOrUpdateMember,
    createGroup,
    createMessage,
    createScrapbookItem,
    createScrapbookPage,
    getGroupById,
    getItemById,
    listGroups,
    listMembers,
    listMessages,
    listScrapbookItems,
    listScrapbookPages,
    markMessageSeen,
} from "../services/group.service.js";

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
        const group = await createGroup(req.body);
        res.status(201).json(group);
    } catch (error) {
        next(error);
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
        const member = await addOrUpdateMember(
            req.params.groupId,
            req.params.userId,
            req.body
        );
        res.json(member);
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
        const page = await createScrapbookPage(req.params.groupId, req.body);
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
