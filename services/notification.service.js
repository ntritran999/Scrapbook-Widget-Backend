import { FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

import { db, firebaseApp } from "../firebaseConfig.js";

const usersCollection = db.collection("users");
const groupsCollection = db.collection("groups");

function makeError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeStringArray(values = []) {
    return Array.from(
        new Set(
            (Array.isArray(values) ? values : [])
                .map((value) => normalizeString(value))
                .filter(Boolean)
        )
    );
}

function normalizeTokenDocId(token) {
    return encodeURIComponent(normalizeString(token));
}

function maskToken(token) {
    const normalized = normalizeString(token);
    if (!normalized) {
        return "";
    }
    if (normalized.length <= 10) {
        return `${normalized.slice(0, 3)}***`;
    }
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function logNotification(message, payload = {}) {
    console.log(`[NOTIFY] ${message} ${JSON.stringify(payload)}`);
}

function sanitizeTokenPayload(payload = {}) {
    const token = normalizeString(payload.token ?? payload.fcmToken);
    if (!token) {
        throw makeError("token is required", 400);
    }

    return {
        token,
        platform: normalizeString(payload.platform || "android") || "android",
        deviceId: normalizeString(payload.deviceId),
        deviceName: normalizeString(payload.deviceName),
        appVersion: normalizeString(payload.appVersion),
        enabled: payload.enabled,
        messageEnabled: payload.messageEnabled,
        photoEnabled: payload.photoEnabled,
        reactionEnabled: payload.reactionEnabled,
    };
}

function resolvePreferenceFlag(value, fallback = true) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
            return true;
        }
        if (normalized === "false") {
            return false;
        }
    }
    return fallback;
}

function sanitizePreferencePayload(payload = {}) {
    const deviceId = normalizeString(payload.deviceId);
    const token = normalizeString(payload.token ?? payload.fcmToken);
    if (!deviceId && !token) {
        throw makeError("token or deviceId is required", 400);
    }

    const updates = {};
    const preferenceKeys = ["enabled", "messageEnabled", "photoEnabled", "reactionEnabled"];
    for (const key of preferenceKeys) {
        if (payload[key] !== undefined) {
            updates[key] = resolvePreferenceFlag(payload[key]);
        }
    }

    if (Object.keys(updates).length === 0) {
        throw makeError("at least one notification preference field is required", 400);
    }

    return {
        deviceId,
        token,
        updates,
    };
}

async function getUserProfile(userId) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        return null;
    }

    const userDoc = await usersCollection.doc(normalizedUserId).get();
    if (!userDoc.exists) {
        return null;
    }

    const data = userDoc.data() || {};
    return {
        id: userDoc.id,
        username: normalizeString(data.username),
        nickname: normalizeString(data.nickname),
        email: normalizeString(data.email),
    };
}

async function getGroupName(groupId) {
    const normalizedGroupId = normalizeString(groupId);
    if (!normalizedGroupId) {
        return "";
    }

    const groupDoc = await groupsCollection.doc(normalizedGroupId).get();
    if (!groupDoc.exists) {
        return "";
    }

    return normalizeString(groupDoc.data()?.groupName);
}

function resolveDisplayName(profile, fallbackId = "") {
    return (
        normalizeString(profile?.nickname) ||
        normalizeString(profile?.username) ||
        normalizeString(profile?.email) ||
        normalizeString(fallbackId)
    );
}

async function listUserTokenEntries(userId) {
    const snapshot = await usersCollection.doc(userId).collection("notificationTokens").get();
    return snapshot.docs
        .map((doc) => ({
            docId: doc.id,
            ...doc.data(),
        }))
        .filter((entry) => normalizeString(entry.token));
}

function isNotificationEnabledForCategory(entry = {}, category = "general") {
    const globallyEnabled = resolvePreferenceFlag(entry.enabled, true);
    if (!globallyEnabled) {
        return false;
    }

    if (category === "message") {
        return resolvePreferenceFlag(entry.messageEnabled, true);
    }
    if (category === "photo") {
        return resolvePreferenceFlag(entry.photoEnabled, true);
    }
    if (category === "reaction") {
        return resolvePreferenceFlag(entry.reactionEnabled, true);
    }

    return true;
}

function getNotificationEligibility(entry = {}, category = "general") {
    const globallyEnabled = resolvePreferenceFlag(entry.enabled, true);
    if (!globallyEnabled) {
        return { eligible: false, reason: "disabled_global" };
    }

    if (category === "message" && !resolvePreferenceFlag(entry.messageEnabled, true)) {
        return { eligible: false, reason: "disabled_message" };
    }
    if (category === "photo" && !resolvePreferenceFlag(entry.photoEnabled, true)) {
        return { eligible: false, reason: "disabled_photo" };
    }
    if (category === "reaction" && !resolvePreferenceFlag(entry.reactionEnabled, true)) {
        return { eligible: false, reason: "disabled_reaction" };
    }

    return { eligible: true, reason: "enabled" };
}

async function removeInvalidTokens(invalidTokenEntries = []) {
    if (!Array.isArray(invalidTokenEntries) || invalidTokenEntries.length === 0) {
        return;
    }

    const batch = db.batch();
    for (const entry of invalidTokenEntries) {
        const userId = normalizeString(entry.userId);
        const docId = normalizeString(entry.docId);
        if (!userId || !docId) {
            continue;
        }
        batch.delete(usersCollection.doc(userId).collection("notificationTokens").doc(docId));
    }
    await batch.commit();
}

async function sendPushToUsers(userIds = [], message = {}, options = {}) {
    const skipUserIds = new Set(normalizeStringArray(options.skipUserIds));
    const dedupedUserIds = normalizeStringArray(userIds).filter((userId) => !skipUserIds.has(userId));
    const category = normalizeString(options.category || "general").toLowerCase();

    if (dedupedUserIds.length === 0) {
        logNotification("skip push: no target users", { category });
        return { sentCount: 0, invalidTokenCount: 0 };
    }

    const tokenEntries = (
        await Promise.all(
            dedupedUserIds.map(async (userId) => {
                const entries = await listUserTokenEntries(userId);
                return entries.map((entry) => ({
                    userId,
                    docId: entry.docId,
                    token: normalizeString(entry.token),
                    enabled: entry.enabled,
                    messageEnabled: entry.messageEnabled,
                    photoEnabled: entry.photoEnabled,
                    reactionEnabled: entry.reactionEnabled,
                }));
            })
        )
    ).flat().filter((entry) => entry.token);

    const eligibleBreakdown = {
        noTokens: dedupedUserIds.length === 0 ? 0 : dedupedUserIds.length,
        disabledGlobal: 0,
        disabledCategory: 0,
        eligible: 0,
    };

    if (tokenEntries.length > 0) {
        eligibleBreakdown.noTokens = 0;
    }

    const filteredTokenEntries = tokenEntries.filter((entry) => {
        const eligibility = getNotificationEligibility(entry, category);
        if (eligibility.eligible) {
            eligibleBreakdown.eligible += 1;
            return true;
        }

        if (eligibility.reason === "disabled_global") {
            eligibleBreakdown.disabledGlobal += 1;
        } else {
            eligibleBreakdown.disabledCategory += 1;
        }
        return false;
    });

    if (filteredTokenEntries.length === 0) {
        logNotification("skip push: no eligible tokens", {
            category,
            requestedUsers: dedupedUserIds.length,
            totalTokens: tokenEntries.length,
            reasons: eligibleBreakdown,
        });
        return { sentCount: 0, invalidTokenCount: 0 };
    }

    const multicastMessage = {
        notification: message.notification,
        data: Object.fromEntries(
            Object.entries(message.data || {}).map(([key, value]) => [key, String(value ?? "")])
        ),
        android: {
            priority: "high",
            notification: {
                channelId: "scrapbook_updates",
                sound: "default",
            },
        },
        tokens: filteredTokenEntries.map((entry) => entry.token),
    };

    const response = await getMessaging(firebaseApp).sendEachForMulticast(multicastMessage);
    const invalidTokenEntries = [];

    response.responses.forEach((result, index) => {
        if (result.success) {
            return;
        }

        const errorCode = normalizeString(result.error?.code);
        if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
        ) {
            invalidTokenEntries.push(filteredTokenEntries[index]);
        }
    });

    await removeInvalidTokens(invalidTokenEntries);

    logNotification("push dispatched", {
        category,
        targetUsers: dedupedUserIds.length,
        targetTokens: filteredTokenEntries.length,
        sentCount: response.successCount,
        failedCount: response.failureCount,
        invalidTokenCount: invalidTokenEntries.length,
        type: normalizeString(message?.data?.type),
        groupId: normalizeString(message?.data?.groupId),
        pageId: normalizeString(message?.data?.pageId),
        itemId: normalizeString(message?.data?.itemId),
        messageId: normalizeString(message?.data?.messageId),
    });

    return {
        sentCount: response.successCount,
        invalidTokenCount: invalidTokenEntries.length,
    };
}

export async function registerNotificationToken(userId, payload = {}) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        throw makeError("unauthorized", 401);
    }

    const tokenPayload = sanitizeTokenPayload(payload);
    const docId = tokenPayload.deviceId || normalizeTokenDocId(tokenPayload.token);
    const docRef = usersCollection
        .doc(normalizedUserId)
        .collection("notificationTokens")
        .doc(docId);

    await docRef.set(
        {
            token: tokenPayload.token,
            platform: tokenPayload.platform,
            deviceId: tokenPayload.deviceId,
            deviceName: tokenPayload.deviceName,
            appVersion: tokenPayload.appVersion,
            enabled: resolvePreferenceFlag(tokenPayload.enabled, true),
            messageEnabled: resolvePreferenceFlag(tokenPayload.messageEnabled, true),
            photoEnabled: resolvePreferenceFlag(tokenPayload.photoEnabled, true),
            reactionEnabled: resolvePreferenceFlag(tokenPayload.reactionEnabled, true),
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    logNotification("token registered", {
        userId: normalizedUserId,
        deviceId: tokenPayload.deviceId || null,
        platform: tokenPayload.platform,
        token: maskToken(tokenPayload.token),
    });

    return {
        success: true,
        token: tokenPayload.token,
        deviceId: tokenPayload.deviceId || null,
        platform: tokenPayload.platform,
    };
}

export async function unregisterNotificationToken(userId, payload = {}) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        throw makeError("unauthorized", 401);
    }

    const token = normalizeString(payload.token ?? payload.fcmToken);
    const deviceId = normalizeString(payload.deviceId);
    if (!token && !deviceId) {
        throw makeError("token or deviceId is required", 400);
    }

    const collectionRef = usersCollection.doc(normalizedUserId).collection("notificationTokens");
    const batch = db.batch();

    if (deviceId) {
        batch.delete(collectionRef.doc(deviceId));
    }

    if (token) {
        batch.delete(collectionRef.doc(normalizeTokenDocId(token)));
        const snapshot = await collectionRef.where("token", "==", token).get();
        for (const doc of snapshot.docs) {
            batch.delete(doc.ref);
        }
    }

    await batch.commit();

    logNotification("token unregistered", {
        userId: normalizedUserId,
        deviceId: deviceId || null,
        token: maskToken(token),
    });

    return { success: true };
}

export async function updateNotificationTokenPreferences(userId, payload = {}) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        throw makeError("unauthorized", 401);
    }

    const preferencePayload = sanitizePreferencePayload(payload);
    const collectionRef = usersCollection.doc(normalizedUserId).collection("notificationTokens");

    let targetDocRef = null;
    if (preferencePayload.deviceId) {
        targetDocRef = collectionRef.doc(preferencePayload.deviceId);
        const targetDoc = await targetDocRef.get();
        if (!targetDoc.exists) {
            throw makeError("notification token not found", 404);
        }
    } else {
        const snapshot = await collectionRef.where("token", "==", preferencePayload.token).limit(1).get();
        if (snapshot.empty) {
            throw makeError("notification token not found", 404);
        }
        targetDocRef = snapshot.docs[0].ref;
    }

    await targetDocRef.set(
        {
            ...preferencePayload.updates,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    const updatedDoc = await targetDocRef.get();
    const updatedData = updatedDoc.data() || {};

    logNotification("token preferences updated", {
        userId: normalizedUserId,
        deviceId: normalizeString(updatedData.deviceId || updatedDoc.id) || null,
        token: maskToken(updatedData.token),
        updates: preferencePayload.updates,
    });

    return {
        success: true,
        deviceId: normalizeString(updatedData.deviceId || updatedDoc.id) || null,
        token: normalizeString(updatedData.token),
        enabled: resolvePreferenceFlag(updatedData.enabled, true),
        messageEnabled: resolvePreferenceFlag(updatedData.messageEnabled, true),
        photoEnabled: resolvePreferenceFlag(updatedData.photoEnabled, true),
        reactionEnabled: resolvePreferenceFlag(updatedData.reactionEnabled, true),
    };
}

export async function sendNewMessageNotifications({
    groupId,
    senderId,
    messageId,
    content = "",
    memberIds = [],
} = {}) {
    const [senderProfile, groupName] = await Promise.all([
        getUserProfile(senderId),
        getGroupName(groupId),
    ]);
    const senderName = resolveDisplayName(senderProfile, senderId);
    const trimmedContent = normalizeString(content);
    const body = trimmedContent
        ? `${senderName}: ${trimmedContent}`
        : `${senderName} sent a new message`;

    return sendPushToUsers(memberIds, {
        notification: {
            title: groupName || "New message",
            body,
        },
        data: {
            type: "message_created",
            groupId,
            messageId,
            senderId,
        },
    }, { skipUserIds: [senderId], category: "message" });
}

export async function sendNewPhotoNotifications({
    groupId,
    pageId,
    itemId,
    senderId,
    memberIds = [],
} = {}) {
    const [senderProfile, groupName] = await Promise.all([
        getUserProfile(senderId),
        getGroupName(groupId),
    ]);
    const senderName = resolveDisplayName(senderProfile, senderId);

    return sendPushToUsers(memberIds, {
        notification: {
            title: groupName || "New photo",
            body: `${senderName} added a new photo`,
        },
        data: {
            type: "photo_created",
            groupId,
            pageId,
            itemId,
            senderId,
        },
    }, { skipUserIds: [senderId], category: "photo" });
}

export async function sendPhotoReactionNotifications({
    groupId,
    pageId,
    itemId,
    ownerId,
    reactorId,
    reactionType = "",
} = {}) {
    const [reactorProfile, groupName] = await Promise.all([
        getUserProfile(reactorId),
        getGroupName(groupId),
    ]);
    const reactorName = resolveDisplayName(reactorProfile, reactorId);
    const body = reactionType
        ? `${reactorName} reacted ${reactionType} to your photo`
        : `${reactorName} reacted to your photo`;

    return sendPushToUsers([ownerId], {
        notification: {
            title: groupName || "Photo reaction",
            body,
        },
        data: {
            type: "photo_reacted",
            groupId,
            pageId,
            itemId,
            ownerId,
            reactorId,
            reactionType,
        },
    }, { skipUserIds: [reactorId], category: "reaction" });
}

export async function sendGroupEventNotificationSafely(dispatcher, payload) {
    try {
        await dispatcher(payload);
    } catch (error) {
        console.error("[NOTIFY] Failed to dispatch push notification", error);
    }
}
