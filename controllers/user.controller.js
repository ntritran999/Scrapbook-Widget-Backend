import {
    checkUsernameAvailability,
    createUser,
    getUserById,
    getGroupsByUserId,
    listUsersForInvite,
    listUsers,
    listUserWidgets,
    uploadAvatarForUser,
    updateUser,
    upsertUserWidget,
} from "../services/user.service.js";

function ensureSelfAccess(req, userId) {
    return req.authUser?.uid === userId;
}

export async function getUsers(req, res, next) {
    try {
        const users = await listUsers();
        res.json(users);
    } catch (error) {
        next(error);
    }
}

export async function getUsersForInviteController(req, res, next) {
    try {
        const users = await listUsersForInvite(req.authUser.uid, req.query.q);
        return res.json(users);
    } catch (error) {
        return next(error);
    }
}

export async function getUser(req, res, next) {
    try {
        if (!ensureSelfAccess(req, req.params.userId)) {
            return res.status(403).json({ message: "forbidden" });
        }

        const user = await getUserById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.json(user);
    } catch (error) {
        return next(error);
    }
}

export async function getUserGroups(req, res, next) {
    try {
        const groups = await getGroupsByUserId(req.params.userId);
        if (!groups) {
            return res.status(404).json({ message: "Groups not found" });
        }
        return res.json(groups);
    } catch (error) {
        return next(error);
    }
}

export async function postUser(req, res, next) {
    try {
        const user = await createUser(req.body);
        res.status(201).json(user);
    } catch (error) {
        next(error);
    }
}

export async function patchUser(req, res, next) {
    try {
        if (!ensureSelfAccess(req, req.params.userId)) {
            return res.status(403).json({ message: "forbidden" });
        }

        const user = await updateUser(req.params.userId, req.body, req.authUser);
        res.json(user);
    } catch (error) {
        next(error);
    }
}

export async function checkUsername(req, res, next) {
    try {
        const result = await checkUsernameAvailability(req.query.q, req.authUser?.uid);
        return res.json(result);
    } catch (error) {
        return next(error);
    }
}

export async function postAvatar(req, res, next) {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "avatar file is required" });
        }

        const result = await uploadAvatarForUser(req.authUser?.uid, req.file.buffer);
        return res.status(200).json(result);
    } catch (error) {
        return next(error);
    }
}

export async function getWidgets(req, res, next) {
    try {
        const widgets = await listUserWidgets(req.params.userId);
        res.json(widgets);
    } catch (error) {
        next(error);
    }
}

export async function putWidget(req, res, next) {
    try {
        const widget = await upsertUserWidget(
            req.params.userId,
            req.params.friendId,
            req.body
        );
        res.json(widget);
    } catch (error) {
        next(error);
    }
}
