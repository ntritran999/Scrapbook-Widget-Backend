import crypto from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";

import { db, firebaseApp } from "../firebaseConfig.js";
import { createGroupWithMembers } from "./group.service.js";
import { sendNewGoogleAccountWelcomeEmail, sendRegisterOtpEmail } from "./mail.service.js";

const usersCollection = db.collection("users");
const groupsCollection = db.collection("groups");
const registerOtpsCollection = db.collection("registerOtps");

const DELETED_USER_UID = "deleted-user";
const DELETED_USER_NAME = "Deleted User";
const DELETED_USER_NICKNAME = "Former Member";
const DELETED_USER_AVATAR_URL = "https://placehold.co/128x128?text=Deleted";
const DELETED_CONTENT_IMAGE_URL = "https://placehold.co/600x400?text=Deleted+Content";
const DELETED_TEXT_CONTENT = "[Content from deleted account]";
const DELETE_BATCH_LIMIT = 450;
const REGISTER_OTP_EXPIRES_MINUTES = 10;
const REGISTER_OTP_RESEND_SECONDS = 60;

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

function normalizeRegisterPayload(payload = {}) {
    const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const normalizedAuth = normalizeAuthPayload(raw);

    return {
        email: normalizedAuth.email,
        password: normalizedAuth.password,
        otpCode: String(raw.otpCode ?? raw.otp ?? raw.code ?? "").trim(),
        displayName: String(raw.displayName || "").trim(),
        username: String(raw.username || "").trim(),
        nickname: String(raw.nickname || "").trim(),
        avatarUrl: String(raw.avatarUrl || "").trim(),
        status: String(raw.status || "active").trim() || "active",
    };
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function normalizeOtpCode(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function encodeEmailDocId(email) {
    return encodeURIComponent(normalizeEmail(email));
}

function generateRegisterOtpCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function hashRegisterOtp(email, otpCode) {
    return crypto
        .createHash("sha256")
        .update(`${normalizeEmail(email)}:${normalizeOtpCode(otpCode)}`)
        .digest("hex");
}

function getOtpExpiryDate() {
    return new Date(Date.now() + REGISTER_OTP_EXPIRES_MINUTES * 60 * 1000);
}

function getOtpRemainingSeconds(lastSentAt) {
    const sentAtDate = lastSentAt instanceof Date ? lastSentAt : null;
    if (!sentAtDate) {
        return 0;
    }

    const elapsedMs = Date.now() - sentAtDate.getTime();
    const remainingMs = REGISTER_OTP_RESEND_SECONDS * 1000 - elapsedMs;
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

function extractIdToken(payload = {}) {
    const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const tokenCandidate = raw?.idToken ?? raw?.firebaseIdToken ?? "";
    return String(tokenCandidate).trim();
}

function deriveUsernameFromToken(decodedToken = {}) {
    const emailLocalPart = String(decodedToken?.email || "").split("@")[0] || "";
    const displayName = String(decodedToken?.name || "");
    const source = (emailLocalPart || displayName || "user").toLowerCase();
    const normalized = source.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 20);

    if (normalized.length >= 3) {
        return normalized;
    }

    const uidPart = normalizeUid(decodedToken?.uid).slice(0, 6) || "guest";
    return `user_${uidPart}`;
}

function buildDefaultScrapbookName(decodedToken = {}) {
    const displayName = String(decodedToken?.name || "").trim();
    if (!displayName) {
        return "My Scrapbook";
    }
    return `${displayName}'s Scrapbook`;
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

async function isEmailAlreadyRegistered(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        return false;
    }

    try {
        await getAuth(firebaseApp).getUserByEmail(normalizedEmail);
        return true;
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            return false;
        }
        throw error;
    }
}

async function consumeRegisterOtp(email, otpCode) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedOtpCode = normalizeOtpCode(otpCode);

    if (!normalizedOtpCode || normalizedOtpCode.length !== 6) {
        throw makeError("otpCode must be a 6-digit code", 400);
    }

    const otpRef = registerOtpsCollection.doc(encodeEmailDocId(normalizedEmail));
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) {
        throw makeError("otp code not found or expired", 400);
    }

    const otpData = otpDoc.data() || {};
    const expiresAtDate =
        typeof otpData.expiresAt?.toDate === "function"
            ? otpData.expiresAt.toDate()
            : otpData.expiresAt instanceof Date
                ? otpData.expiresAt
                : null;

    if (!expiresAtDate || expiresAtDate.getTime() <= Date.now()) {
        await otpRef.delete();
        throw makeError("otp code expired", 400);
    }

    const expectedHash = String(otpData.otpHash || "");
    const actualHash = hashRegisterOtp(normalizedEmail, normalizedOtpCode);
    if (!expectedHash || expectedHash !== actualHash) {
        throw makeError("invalid otp code", 400);
    }

    await otpRef.delete();
}

async function cleanupDeletedAccountData(normalizedUid) {
    const writer = createBatchWriter();

    let ownershipTransferredGroups = 0;
    let removedMemberships = 0;
    let anonymizedMessages = 0;
    let removedSeenBy = 0;
    let anonymizedPages = 0;
    let anonymizedItems = 0;
    let anonymizedWidgets = 0;
    let deletedOwnWidgets = 0;

    const [groupsSnapshot, usersSnapshot] = await Promise.all([
        groupsCollection.get(),
        usersCollection.get(),
    ]);

    for (const groupDoc of groupsSnapshot.docs) {
        const [membersSnapshot, messagesSnapshot, pagesSnapshot] = await Promise.all([
            groupDoc.ref.collection("members").get(),
            groupDoc.ref.collection("messages").get(),
            groupDoc.ref.collection("scrapbookPages").get(),
        ]);

        const memberDoc = membersSnapshot.docs.find((doc) => doc.id === normalizedUid);
        const isOwner = String(groupDoc.data()?.createdBy || "") === normalizedUid;

        if (isOwner) {
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

        if (memberDoc) {
            await writer.del(memberDoc.ref);
            removedMemberships += 1;
        }

        for (const messageDoc of messagesSnapshot.docs) {
            const messageData = messageDoc.data() || {};

            if (String(messageData.createdBy || "") === normalizedUid) {
                const currentContent = messageData.content;
                const normalizedType = String(messageData.type || "text");

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

            const seenByDoc = await messageDoc.ref.collection("seenBy").doc(normalizedUid).get();
            if (seenByDoc.exists) {
                await writer.del(seenByDoc.ref);
                removedSeenBy += 1;
            }
        }

        for (const pageDoc of pagesSnapshot.docs) {
            const pageData = pageDoc.data() || {};

            if (String(pageData.createdBy || "") === normalizedUid) {
                await writer.set(
                    pageDoc.ref,
                    {
                        createdBy: DELETED_USER_UID,
                    },
                    { merge: true }
                );
                anonymizedPages += 1;
            }

            const itemsSnapshot = await pageDoc.ref.collection("items").get();
            for (const itemDoc of itemsSnapshot.docs) {
                const itemData = itemDoc.data() || {};
                if (String(itemData.createdBy || "") !== normalizedUid) {
                    continue;
                }

                const currentContent = itemData.content;
                const normalizedType = String(itemData.type || "text");

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
        }
    }

    for (const userDoc of usersSnapshot.docs) {
        if (userDoc.id === normalizedUid) {
            continue;
        }

        const widgetDoc = await userDoc.ref.collection("widgets").doc(normalizedUid).get();
        if (!widgetDoc.exists) {
            continue;
        }

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

    return {
        groupsOwnershipTransferred: ownershipTransferredGroups,
        membershipsRemoved: removedMemberships,
        messagesAnonymized: anonymizedMessages,
        messageSeenByRemoved: removedSeenBy,
        scrapbookPagesAnonymized: anonymizedPages,
        scrapbookItemsAnonymized: anonymizedItems,
        widgetsAnonymized: anonymizedWidgets,
        ownWidgetsRemoved: deletedOwnWidgets,
        batchCommits,
    };
}

async function finalizeDeletedAuthAccount(normalizedUid) {
    const auth = getAuth(firebaseApp);

    try {
        await auth.revokeRefreshTokens(normalizedUid);
    } catch (error) {
        if (error?.code !== "auth/user-not-found") {
            throw error;
        }
    }

    try {
        await auth.deleteUser(normalizedUid);
        return {
            hardDeletedAuth: true,
            alreadyDeleted: false,
        };
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            return {
                hardDeletedAuth: true,
                alreadyDeleted: true,
            };
        }
        throw error;
    }
}

export async function registerWithEmailAndPassword(payload) {
    const normalized = normalizeRegisterPayload(payload);
    const {
        email: rawEmail,
        password,
        otpCode,
        displayName,
        username,
        nickname,
        avatarUrl,
        status,
    } = normalized;
    const email = normalizeEmail(rawEmail);

    if (!email || !password) {
        throw makeError(
            "email and password are required (accepted keys: email/mail/userEmail + password/pass/userPassword)",
            400
        );
    }

    if (!isValidEmail(email)) {
        throw makeError("email format is invalid", 400);
    }

    if (String(password).length < 6) {
        throw makeError("password must be at least 6 characters", 400);
    }

    if (!otpCode) {
        throw makeError("otpCode is required", 400);
    }

    await consumeRegisterOtp(email, otpCode);

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

        const starterGroup = await createGroupWithMembers({
            groupName: "Default Scrapbook",
            avatarUrl: "",
            createdBy: userRecord.uid,
            memberIds: [],
        });

        return {
            uid: userRecord.uid,
            email: userRecord.email,
            onboarding: {
                defaultGroupId: starterGroup.id,
                defaultGroupName: starterGroup.groupName,
                defaultPageId: starterGroup.latestPage?.id || null,
            },
        };
    } catch (error) {
        if (error?.code === "auth/email-already-exists") {
            throw makeError("email already exists", 409);
        }
        throw error;
    }
}

export async function sendRegisterOtp(payload) {
    const normalized = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const email = normalizeEmail(
        normalized.email ??
        normalized.mail ??
        normalized.userEmail ??
        ""
    );

    if (!email) {
        throw makeError("email is required", 400);
    }

    if (!isValidEmail(email)) {
        throw makeError("email format is invalid", 400);
    }

    const emailExists = await isEmailAlreadyRegistered(email);
    if (emailExists) {
        throw makeError("email already exists", 409);
    }

    const otpRef = registerOtpsCollection.doc(encodeEmailDocId(email));
    const otpDoc = await otpRef.get();
    const otpData = otpDoc.exists ? (otpDoc.data() || {}) : {};
    const lastSentAt =
        typeof otpData.lastSentAt?.toDate === "function"
            ? otpData.lastSentAt.toDate()
            : otpData.lastSentAt instanceof Date
                ? otpData.lastSentAt
                : null;
    const retryAfterSeconds = getOtpRemainingSeconds(lastSentAt);

    if (retryAfterSeconds > 0) {
        throw makeError(`please wait ${retryAfterSeconds}s before requesting a new otp`, 429);
    }

    const otpCode = generateRegisterOtpCode();
    const expiresAt = getOtpExpiryDate();

    await otpRef.set(
        {
            email,
            otpHash: hashRegisterOtp(email, otpCode),
            expiresAt,
            lastSentAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    let emailDelivery = {
        sent: false,
        skipped: true,
        reason: "unknown",
    };

    try {
        emailDelivery = await sendRegisterOtpEmail({
            toEmail: email,
            otpCode,
            expiresInMinutes: REGISTER_OTP_EXPIRES_MINUTES,
        });
    } catch (error) {
        console.error(`[AUTH_OTP] Failed to send register OTP to ${email}`, error);
        emailDelivery = {
            sent: false,
            skipped: false,
            reason: "send-failed",
        };
    }

    if (!emailDelivery.sent) {
        await otpRef.delete();
        throw makeError(
            emailDelivery.reason === "smtp-not-configured"
                ? "smtp is not configured for otp delivery"
                : "failed to send otp email",
            500
        );
    }

    return {
        email,
        otpSent: true,
        expiresInMinutes: REGISTER_OTP_EXPIRES_MINUTES,
        retryAfterSeconds: REGISTER_OTP_RESEND_SECONDS,
    };
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
    const idToken = extractIdToken(payload);

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

export async function loginWithGoogleIdToken(payload) {
    const idToken = extractIdToken(payload);

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

    const uid = normalizeUid(decodedToken.uid);
    if (!uid) {
        throw makeError("invalid or expired idToken", 401);
    }

    const userRef = usersCollection.doc(uid);
    const userSnapshot = await userRef.get();

    if (userSnapshot.exists && isAccountBlocked(userSnapshot.data())) {
        await getAuth(firebaseApp).revokeRefreshTokens(uid);
        throw makeError("account is inactive or deleted", 403);
    }

    const isNewUser = !userSnapshot.exists;
    const upsertPayload = {
        email: decodedToken.email || "",
        nickname: decodedToken.name || "",
        avatarUrl: decodedToken.picture || "",
        status: "active",
        provider: "google.com",
        lastLoginAt: FieldValue.serverTimestamp(),
    };

    if (isNewUser) {
        upsertPayload.username = deriveUsernameFromToken(decodedToken);
        upsertPayload.createdAt = FieldValue.serverTimestamp();
    }

    await userRef.set(upsertPayload, { merge: true });

    let onboarding = null;
    let welcomeEmail = {
        sent: false,
        skipped: true,
        reason: "not-a-new-user",
    };

    if (isNewUser) {
        const starterGroup = await createGroupWithMembers({
            groupName: buildDefaultScrapbookName(decodedToken),
            avatarUrl: "",
            createdBy: uid,
            memberIds: [],
        });

        onboarding = {
            defaultGroupId: starterGroup.id,
            defaultGroupName: starterGroup.groupName,
            defaultPageId: starterGroup.latestPage?.id || null,
        };

        try {
            welcomeEmail = await sendNewGoogleAccountWelcomeEmail({
                toEmail: decodedToken.email,
                displayName: decodedToken.name,
                defaultGroupName: starterGroup.groupName,
            });
        } catch (error) {
            console.warn("Failed to send welcome email for new Google account:", error);
            welcomeEmail = {
                sent: false,
                skipped: false,
                reason: "send-failed",
            };
        }
    }

    return {
        uid,
        email: decodedToken.email || null,
        name: decodedToken.name || null,
        picture: decodedToken.picture || null,
        isNewUser,
        onboarding,
        welcomeEmail,
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

    setImmediate(() => {
        Promise.all([
            finalizeDeletedAuthAccount(normalizedUid),
            cleanupDeletedAccountData(normalizedUid),
        ])
            .then(([authResult, cleanup]) => {
                console.log(`[ACCOUNT_DELETE] Background cleanup completed for ${normalizedUid}`, {
                    ...authResult,
                    cleanup,
                });
            })
            .catch((error) => {
                console.error(`[ACCOUNT_DELETE] Background cleanup failed for ${normalizedUid}`, error);
            });
    });

    return {
        uid: normalizedUid,
        softDeleted: true,
        hardDeletedAuth: false,
        cleanupStarted: true,
        placeholders: {
            userAvatarUrl: DELETED_USER_AVATAR_URL,
            contentImageUrl: DELETED_CONTENT_IMAGE_URL,
            text: DELETED_TEXT_CONTENT,
        },
        cleanup: null,
    };
}
