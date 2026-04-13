import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firebaseConfig.js";
import { MessageModel, UserModel, WidgetModel } from "../models/index.js";
import { uploadToCloudinary } from "./cloudinary.service.js";

const usersCollection = db.collection("users");

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function makeError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function sanitizeProfilePatch(payload = {}) {
    const allowedKeys = ["nickname", "username", "avatarUrl", "status", "email"];
    const unknownKeys = Object.keys(payload).filter((key) => !allowedKeys.includes(key));

    if (unknownKeys.length > 0) {
        throw makeError(`unknown fields: ${unknownKeys.join(", ")}`, 400);
    }

    const sanitized = {};
    for (const key of allowedKeys) {
        if (payload[key] !== undefined) {
            sanitized[key] = payload[key];
        }
    }

    if (sanitized.username !== undefined) {
        const username = String(sanitized.username).trim();
        if (!USERNAME_PATTERN.test(username)) {
            throw makeError(
                "username must be 3-20 characters and only contain letters, numbers, underscore",
                400
            );
        }
        sanitized.username = username;
    }

    if (sanitized.nickname !== undefined) {
        sanitized.nickname = String(sanitized.nickname).trim();
    }

    if (sanitized.avatarUrl !== undefined) {
        sanitized.avatarUrl = String(sanitized.avatarUrl).trim();
    }

    if (sanitized.status !== undefined) {
        sanitized.status = String(sanitized.status).trim();
    }

    if (sanitized.email !== undefined) {
        sanitized.email = String(sanitized.email).trim();
    }

    return sanitized;
}

async function isUsernameTakenCaseInsensitive(username, excludeUserId = null) {
    const normalized = String(username).toLowerCase();
    const snapshot = await usersCollection.get();

    return snapshot.docs.some((doc) => {
        if (excludeUserId && doc.id === excludeUserId) {
            return false;
        }
        const candidate = String(doc.data()?.username || "").toLowerCase();
        return candidate === normalized;
    });
}

export async function listUsers() {
    const snapshot = await usersCollection.get();
    return snapshot.docs.map(UserModel.fromSnapshot);
}

export async function listUsersForInvite(currentUserId, keyword = "") {
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    const snapshot = await usersCollection.get();
    const users = snapshot.docs.map(UserModel.fromSnapshot);

    return users.filter((user) => {
        if (user.id === currentUserId) {
            return false;
        }

        if (!normalizedKeyword) {
            return true;
        }

        const username = String(user.username || "").toLowerCase();
        const nickname = String(user.nickname || "").toLowerCase();
        const email = String(user.email || "").toLowerCase();

        return (
            username.includes(normalizedKeyword) ||
            nickname.includes(normalizedKeyword) ||
            email.includes(normalizedKeyword)
        );
    });
}

export async function getUserById(userId) {
    const doc = await usersCollection.doc(userId).get();
    if (!doc.exists) {
        return null;
    }
    return UserModel.fromSnapshot(doc);
}

export async function getGroupsByUserId(userId) {
    const widgetsSnapshot = await usersCollection.doc(userId).collection("widgets").get();

    const groupIds = new Set(
        widgetsSnapshot.docs
            .map((doc) => doc.data()?.groupId || doc.id)
            .filter(Boolean)
    );

    const groupDocs = await Promise.all(
        Array.from(groupIds).map((groupId) => db.collection("groups").doc(groupId).get())
    );

    const groups = groupDocs
        .filter((doc) => doc.exists)
        .map((doc) => ({ id: doc.id, ...doc.data() }));

    const groupsWithLatestMessage = await Promise.all(
        groups.map(async (group) => {
            const latestMessageSnapshot = await db
                .collection("groups")
                .doc(group.id)
                .collection("messages")
                .orderBy("createdAt", "desc")
                .limit(1)
                .get();

            const latestMessage = latestMessageSnapshot.empty
                ? null
                : MessageModel.fromSnapshot(latestMessageSnapshot.docs[0]);

            return {
                ...group,
                latestMessage,
            };
        })
    );

    return groupsWithLatestMessage;
}

export async function createUser(payload) {
    const docRef = usersCollection.doc();
    const user = new UserModel({ ...payload, createdAt: FieldValue.serverTimestamp() });
    await docRef.set(user.toFirestore());
    const created = await docRef.get();
    return UserModel.fromSnapshot(created);
}

export async function updateUser(userId, payload, authUser = null) {
    const sanitizedPayload = sanitizeProfilePatch(payload);

    if (sanitizedPayload.email !== undefined) {
        const tokenEmail = String(authUser?.email || "").trim();
        if (!tokenEmail) {
            throw makeError("token email is missing, please re-authenticate", 401);
        }

        if (sanitizedPayload.email !== tokenEmail) {
            throw makeError("email must match Firebase token email", 400);
        }
    }

    if (Object.keys(sanitizedPayload).length === 0) {
        throw makeError("at least one updatable field is required", 400);
    }

    if (sanitizedPayload.username) {
        const taken = await isUsernameTakenCaseInsensitive(
            sanitizedPayload.username,
            userId
        );
        if (taken) {
            throw makeError("username already exists", 409);
        }
    }

    const docRef = usersCollection.doc(userId);
    await docRef.set(sanitizedPayload, { merge: true });
    const updated = await docRef.get();
    return UserModel.fromSnapshot(updated);
}

export async function enrollFace(userId, faceVector) {
    try {
        // Validate face vector
        if (!Array.isArray(faceVector) || faceVector.length !== 192) {
            const error = new Error("Face vector must be an array of 192 numbers");
            error.statusCode = 400;
            throw error;
        }

        // Validate all elements are numbers
        if (!faceVector.every(val => typeof val === 'number')) {
            const error = new Error("All face vector elements must be numbers");
            error.statusCode = 400;
            throw error;
        }

        const docRef = usersCollection.doc(userId);
        
        // Update user with face vector
        await docRef.set(
            { faceVector: faceVector },
            { merge: true }
        );

        const updated = await docRef.get();
        if (!updated.exists) {
            const error = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        return UserModel.fromSnapshot(updated);
    } catch (error) {
        throw error;
    }
}

export async function checkUsernameAvailability(usernameQuery, currentUserId = null) {
    const username = String(usernameQuery || "").trim();
    if (!username) {
        throw makeError("query parameter q is required", 400);
    }

    if (!USERNAME_PATTERN.test(username)) {
        return {
            available: false,
            valid: false,
            reason: "username must be 3-20 characters and only contain letters, numbers, underscore",
        };
    }

    const taken = await isUsernameTakenCaseInsensitive(username, currentUserId);
    return {
        available: !taken,
        valid: true,
    };
}

export async function uploadAvatarForUser(userId, fileBuffer) {
    if (!userId) {
        throw makeError("unauthorized", 401);
    }

    if (!fileBuffer) {
        throw makeError("avatar file is required", 400);
    }

    const userRef = usersCollection.doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
        throw makeError("User not found", 404);
    }

    const uploaded = await uploadToCloudinary(fileBuffer, "avatar", userId, "profile");

    await userRef.set(
        {
            avatarUrl: uploaded.secure_url,
        },
        { merge: true }
    );

    return {
        avatarUrl: uploaded.secure_url,
    };
}

export async function listUserWidgets(userId) {
    const snapshot = await usersCollection.doc(userId).collection("widgets").orderBy("updatedAt", "desc").get();
    return snapshot.docs.map(WidgetModel.fromSnapshot);
}

export async function upsertUserWidget(userId, friendId, payload) {
    const docRef = usersCollection.doc(userId).collection("widgets").doc(friendId);
    const widget = new WidgetModel({
        ...payload,
        id: friendId,
        updatedAt: FieldValue.serverTimestamp(),
    });

    await docRef.set(widget.toFirestore(), { merge: true });
    const updated = await docRef.get();
    return WidgetModel.fromSnapshot(updated);
}
