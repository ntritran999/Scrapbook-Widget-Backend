import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { db, firebaseApp } from "../firebaseConfig.js";

const usersCollection = db.collection("users");
const groupsCollection = db.collection("groups");

const DELETED_USER_UID = "deleted-user";
const DELETED_USER_NAME = "Deleted User";
const DELETED_USER_NICKNAME = "Former Member";
const DELETED_USER_AVATAR_URL = "https://placehold.co/128x128?text=Deleted";
const DELETED_CONTENT_IMAGE_URL = "https://placehold.co/600x400?text=Deleted+Content";
const DELETED_TEXT_CONTENT = "[Content from deleted account]";
const DELETE_BATCH_LIMIT = 450;

function makeError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeAuthPayload(payload = {}) {
    const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;

    const emailCandidate =
        raw.email ??
        raw.mail ??
        raw.userEmail ??
        raw.username ??
        "";

    const passwordCandidate =
        raw.password ??
        raw.pass ??
        raw.userPassword ??
        "";

    return {
        email: String(emailCandidate).trim(),
        password: String(passwordCandidate),
    };
}

function mapFirebaseLoginError(firebaseMessage = "") {
    if (
        firebaseMessage === "INVALID_PASSWORD" ||
        firebaseMessage === "EMAIL_NOT_FOUND" ||
        firebaseMessage === "INVALID_LOGIN_CREDENTIALS" ||
        firebaseMessage === "USER_DISABLED"
    ) {
        return makeError("invalid email or password", 401);
    }

    if (firebaseMessage === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        return makeError("too many attempts, please try again later", 429);
    }

    return makeError("firebase login failed", 502);
}

function normalizeUid(uid) {
    return String(uid || "").trim();
}

function isAccountBlocked(userData = {}) {
    const status = String(userData?.status || "").trim().toLowerCase();
    return status === "inactive" || userData?.isDeleted === true;
}

function pickReplacementOwner(memberDocs, deletedUid) {
    const members = memberDocs
        .map((doc) => ({ id: doc.id, role: String(doc.data()?.role || "member") }))
        .filter((member) => member.id && member.id !== deletedUid);

    const admin = members.find((member) => member.role === "admin");
    if (admin) {
        return admin.id;
    }

    return members.length > 0 ? members[0].id : DELETED_USER_UID;
}

function hasMeaningfulContent(content) {
    if (content === null || content === undefined) {
        return false;
    }
    if (typeof content === "string") {
        return content.trim().length > 0;
    }
    if (typeof content === "object") {
        return Object.keys(content).length > 0;
    }
    return true;
}

function fallbackContentByType(type) {
    if (type === "photo" || type === "image") {
        return { imageUrl: DELETED_CONTENT_IMAGE_URL, caption: DELETED_TEXT_CONTENT };
    }
    return { text: DELETED_TEXT_CONTENT };
}

function createBatchWriter() {
    let batch = db.batch();
    let count = 0;
    let commits = 0;

    async function flushIfNeeded() {
        if (count < DELETE_BATCH_LIMIT) {
            return;
        }

        await batch.commit();
        commits += 1;
        batch = db.batch();
        count = 0;
    }

    async function set(ref, data, options = undefined) {
        if (options) {
            batch.set(ref, data, options);
        } else {
            batch.set(ref, data);
        }
        count += 1;
        await flushIfNeeded();
    }

    async function del(ref) {
        batch.delete(ref);
        count += 1;
        await flushIfNeeded();
    }

    async function commitAll() {
        if (count > 0) {
            await batch.commit();
            commits += 1;
            batch = db.batch();
            count = 0;
        }
        return commits;
    }

    return { set, del, commitAll };
}

export async function registerWithEmailAndPassword(payload) {
    const normalized = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const { email, password } = normalizeAuthPayload(normalized);
    const {
        displayName = "",
        username = "",
        nickname = "",
        avatarUrl = "",
        status = "active",
    } = normalized;

    if (!email || !password) {
        throw makeError(
            "email and password are required (accepted keys: email/mail/userEmail + password/pass/userPassword)",
            400
        );
    }

    if (String(password).length < 6) {
        throw makeError("password must be at least 6 characters", 400);
    }

    try {
        const auth = getAuth(firebaseApp);
        const userRecord = await auth.createUser({
            email,
            password,
            displayName,
        });

        await usersCollection.doc(userRecord.uid).set(
            {
                username: username || displayName || email.split("@")[0],
                nickname: nickname || displayName || "",
                email,
                avatarUrl,
                status,
                createdAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        return {
            uid: userRecord.uid,
            email: userRecord.email,
        };
    } catch (error) {
        if (error?.code === "auth/email-already-exists") {
            throw makeError("email already exists", 409);
        }
        throw error;
    }
}

export async function loginWithEmailAndPassword(payload) {
    const { email, password } = normalizeAuthPayload(payload);

    if (!email || !password) {
        throw makeError(
            "email and password are required (accepted keys: email/mail/userEmail + password/pass/userPassword)",
            400
        );
    }

    const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!firebaseWebApiKey) {
        throw makeError("FIREBASE_WEB_API_KEY is not configured", 500);
    }

    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseWebApiKey}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true,
            }),
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const firebaseMessage = data?.error?.message || "";
        throw mapFirebaseLoginError(firebaseMessage);
    }

    const uid = normalizeUid(data.localId);
    if (!uid) {
        throw makeError("firebase login failed", 502);
    }

    const userSnapshot = await usersCollection.doc(uid).get();
    if (userSnapshot.exists && isAccountBlocked(userSnapshot.data())) {
        await getAuth(firebaseApp).revokeRefreshTokens(uid);
        throw makeError("account is inactive or deleted", 403);
    }

    return {
        uid,
        email: data.email,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresIn: Number(data.expiresIn),
    };
}

export async function verifyIdTokenAndCreateSession(payload) {
    const { idToken } = payload;

    if (!idToken) {
        throw makeError("idToken is required", 400);
    }

    let decodedToken;
    try {
        decodedToken = await getAuth(firebaseApp).verifyIdToken(idToken);
    } catch (error) {
        if (
            error?.code === "auth/id-token-expired" ||
            error?.code === "auth/invalid-id-token" ||
            error?.code === "auth/argument-error"
        ) {
            throw makeError("invalid or expired idToken", 401);
        }
        throw error;
    }

    return {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
        name: decodedToken.name || null,
        picture: decodedToken.picture || null,
        session: {
            valid: true,
            authTime: decodedToken.auth_time || null,
            issuedAt: decodedToken.iat || null,
            expiresAt: decodedToken.exp || null,
        },
    };
}

export async function signOutByUid(uid) {
    const normalizedUid = normalizeUid(uid);

    if (!normalizedUid) {
        throw makeError("unauthorized", 401);
    }

    const auth = getAuth(firebaseApp);

    await auth.revokeRefreshTokens(normalizedUid);
    const userRecord = await auth.getUser(normalizedUid);

    return {
        uid: normalizedUid,
        signedOut: true,
        tokensValidAfterTime: userRecord.tokensValidAfterTime || null,
    };
}

export async function deleteAccountByUid(uid) {
    const normalizedUid = normalizeUid(uid);

    if (!normalizedUid) {
        throw makeError("unauthorized", 401);
    }

    const auth = getAuth(firebaseApp);
    const writer = createBatchWriter();

    await usersCollection.doc(normalizedUid).set(
        {
            username: DELETED_USER_NAME,
            nickname: DELETED_USER_NICKNAME,
            email: "",
            avatarUrl: DELETED_USER_AVATAR_URL,
            status: "inactive",
            isDeleted: true,
            deletedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    let ownershipTransferredGroups = 0;
    let removedMemberships = 0;
    let anonymizedMessages = 0;
    let removedSeenBy = 0;
    let anonymizedPages = 0;
    let anonymizedItems = 0;
    let anonymizedWidgets = 0;
    let deletedOwnWidgets = 0;

    const ownedGroupsSnapshot = await groupsCollection.where("createdBy", "==", normalizedUid).get();
    for (const groupDoc of ownedGroupsSnapshot.docs) {
        const membersSnapshot = await groupDoc.ref.collection("members").get();
        const replacementOwner = pickReplacementOwner(membersSnapshot.docs, normalizedUid);

        await writer.set(
            groupDoc.ref,
            {
                createdBy: replacementOwner,
            },
            { merge: true }
        );
        ownershipTransferredGroups += 1;
    }

    const membershipsSnapshot = await db
        .collectionGroup("members")
        .where(FieldPath.documentId(), "==", normalizedUid)
        .get();
    for (const memberDoc of membershipsSnapshot.docs) {
        await writer.del(memberDoc.ref);
        removedMemberships += 1;
    }

    const messagesSnapshot = await db
        .collectionGroup("messages")
        .where("createdBy", "==", normalizedUid)
        .get();
    for (const messageDoc of messagesSnapshot.docs) {
        const data = messageDoc.data() || {};
        const currentContent = data.content;
        const normalizedType = String(data.type || "text");

        await writer.set(
            messageDoc.ref,
            {
                createdBy: DELETED_USER_UID,
                content: hasMeaningfulContent(currentContent)
                    ? currentContent
                    : fallbackContentByType(normalizedType),
            },
            { merge: true }
        );
        anonymizedMessages += 1;
    }

    const seenBySnapshot = await db
        .collectionGroup("seenBy")
        .where(FieldPath.documentId(), "==", normalizedUid)
        .get();
    for (const seenByDoc of seenBySnapshot.docs) {
        await writer.del(seenByDoc.ref);
        removedSeenBy += 1;
    }

    const pagesSnapshot = await db
        .collectionGroup("scrapbookPages")
        .where("createdBy", "==", normalizedUid)
        .get();
    for (const pageDoc of pagesSnapshot.docs) {
        await writer.set(
            pageDoc.ref,
            {
                createdBy: DELETED_USER_UID,
            },
            { merge: true }
        );
        anonymizedPages += 1;
    }

    const itemsSnapshot = await db
        .collectionGroup("items")
        .where("createdBy", "==", normalizedUid)
        .get();
    for (const itemDoc of itemsSnapshot.docs) {
        const data = itemDoc.data() || {};
        const currentContent = data.content;
        const normalizedType = String(data.type || "text");

        await writer.set(
            itemDoc.ref,
            {
                createdBy: DELETED_USER_UID,
                content: hasMeaningfulContent(currentContent)
                    ? currentContent
                    : fallbackContentByType(normalizedType),
            },
            { merge: true }
        );
        anonymizedItems += 1;
    }

    const widgetsSnapshot = await db
        .collectionGroup("widgets")
        .where(FieldPath.documentId(), "==", normalizedUid)
        .get();
    for (const widgetDoc of widgetsSnapshot.docs) {
        await writer.set(
            widgetDoc.ref,
            {
                latestPhotoUrl: DELETED_CONTENT_IMAGE_URL,
                senderAvatar: DELETED_USER_AVATAR_URL,
                status: "inactive",
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        anonymizedWidgets += 1;
    }

    const ownWidgetsSnapshot = await usersCollection.doc(normalizedUid).collection("widgets").get();
    for (const widgetDoc of ownWidgetsSnapshot.docs) {
        await writer.del(widgetDoc.ref);
        deletedOwnWidgets += 1;
    }

    const batchCommits = await writer.commitAll();

    await auth.revokeRefreshTokens(normalizedUid);

    try {
        await auth.deleteUser(normalizedUid);
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            throw makeError("account not found", 404);
        }
        throw error;
    }

    return {
        uid: normalizedUid,
        softDeleted: true,
        hardDeletedAuth: true,
        placeholders: {
            userAvatarUrl: DELETED_USER_AVATAR_URL,
            contentImageUrl: DELETED_CONTENT_IMAGE_URL,
            text: DELETED_TEXT_CONTENT,
        },
        cleanup: {
            groupsOwnershipTransferred: ownershipTransferredGroups,
            membershipsRemoved: removedMemberships,
            messagesAnonymized: anonymizedMessages,
            messageSeenByRemoved: removedSeenBy,
            scrapbookPagesAnonymized: anonymizedPages,
            scrapbookItemsAnonymized: anonymizedItems,
            widgetsAnonymized: anonymizedWidgets,
            ownWidgetsRemoved: deletedOwnWidgets,
            batchCommits,
        },
    };
}