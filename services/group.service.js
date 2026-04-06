import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firebaseConfig.js";
import {
    GroupModel,
    MemberModel,
    MessageModel,
    ReactionModel,
    ScrapbookItemModel,
    ScrapbookPageModel,
    SeenByModel,
} from "../models/index.js";
import { uploadToCloudinary } from "./cloudinary.service.js";
import { publishGroupMessageEvent } from "./messageRealtime.service.js";

const groupsCollection = db.collection("groups");
const usersCollection = db.collection("users");
const TODAY_MEMORY_FALLBACK_LIMIT = 10;

// Utility: Calculate Cosine Similarity between two vectors
function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Helper: Get all members' face vectors from group
async function getMembersFaceVectors(groupId) {
    try {
        const members = await listMembers(groupId);
        const memberFaceVectors = [];

        for (const member of members) {
            const userDoc = await usersCollection.doc(member.id).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData.faceVector && Array.isArray(userData.faceVector)) {
                    memberFaceVectors.push({
                        userId: member.id,
                        faceVector: userData.faceVector,
                    });
                }
            }
        }

        return memberFaceVectors;
    } catch (error) {
        console.error("Error fetching members' face vectors:", error);
        return [];
    }
}

// Helper: Match face embeddings against group members
async function matchFaceEmbeddings(groupId, embeddings, threshold = 0.4) {
    try {
        if (!Array.isArray(embeddings) || embeddings.length === 0) {
            return [];
        }

        const memberFaceVectors = await getMembersFaceVectors(groupId);
        console.log(`Found ${memberFaceVectors.length} member face vectors for group ${groupId}`);
        if (memberFaceVectors.length === 0) {
            return [];
        }

        const taggedUserIds = new Set();

        // For each embedding from the mobile app
        for (const embedding of embeddings) {
            if (!Array.isArray(embedding) || embedding.length !== 192) {
                continue; // Skip invalid embeddings
            }

            // Compare against each member's face vector
            for (const memberFace of memberFaceVectors) {
                const similarity = cosineSimilarity(embedding, memberFace.faceVector);
                console.log(`Similarity with user ${memberFace.userId}: ${similarity.toFixed(4)}`);
                if (similarity > threshold) {
                    taggedUserIds.add(memberFace.userId);
                }
            }
        }

        return Array.from(taggedUserIds);
    } catch (error) {
        console.error("Error matching face embeddings:", error);
        return [];
    }
}
const INVITATION_STATUS_PENDING = "pending";
const INVITATION_STATUS_ACCEPTED = "accepted";
const INVITATION_STATUS_DECLINED = "declined";
const INVITATION_SOURCE_DIRECT = "direct";
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_MAX_ATTEMPTS = 10;

function pickUserName(userData = {}, fallbackId = "") {
    return (
        String(userData.nickname || "").trim() ||
        String(userData.username || "").trim() ||
        String(userData.email || "").trim() ||
        fallbackId
    );
}

function buildSeenByText(seenUsers = []) {
    if (!Array.isArray(seenUsers) || seenUsers.length === 0) {
        return "Seen by no one";
    }

    const names = seenUsers.map((user) => user.name).filter(Boolean);
    if (names.length === 0) {
        return "Seen";
    }

    return `Seen by ${names.join(", ")}`;
}

async function getUserProfilesMap(userIds = []) {
    const uniqueUserIds = Array.from(new Set((userIds || []).filter(Boolean)));
    if (uniqueUserIds.length === 0) {
        return new Map();
    }

    const userDocs = await Promise.all(
        uniqueUserIds.map((userId) => usersCollection.doc(userId).get())
    );

    return new Map(
        userDocs.map((doc) => {
            const data = doc.exists ? (doc.data() || {}) : {};
            return [
                doc.id,
                {
                    id: doc.id,
                    name: pickUserName(data, doc.id),
                    avatarUrl: String(data.avatarUrl || ""),
                },
            ];
        })
    );
}

async function enrichMessagesForUi(groupId, messageDocs = []) {
    if (!Array.isArray(messageDocs) || messageDocs.length === 0) {
        return [];
    }

    const messages = messageDocs.map(MessageModel.fromSnapshot);
    const messageIds = messages.map((message) => message.id).filter(Boolean);

    const seenBySnapshots = await Promise.all(
        messageIds.map((messageId) =>
            groupsCollection.doc(groupId).collection("messages").doc(messageId).collection("seenBy").get()
        )
    );

    const seenByMap = new Map(
        seenBySnapshots.map((snapshot, index) => {
            const seenRows = snapshot.docs.map(SeenByModel.fromSnapshot);
            return [messageIds[index], seenRows];
        })
    );

    const senderIds = messages.map((message) => message.createdBy).filter(Boolean);
    const seenUserIds = Array.from(
        new Set(
            Array.from(seenByMap.values())
                .flat()
                .map((seen) => seen.id)
                .filter(Boolean)
        )
    );

    const userProfiles = await getUserProfilesMap([...senderIds, ...seenUserIds]);

    return messages.map((message) => {
        const senderProfile = userProfiles.get(message.createdBy) || {
            id: message.createdBy,
            name: message.createdBy,
            avatarUrl: "",
        };

        const seenUsers = (seenByMap.get(message.id) || []).map((seen) => {
            const profile = userProfiles.get(seen.id) || {
                id: seen.id,
                name: seen.id,
                avatarUrl: "",
            };

            return {
                id: seen.id,
                name: profile.name,
                avatarUrl: profile.avatarUrl,
                seenAt: seen.seenAt,
            };
        });

        return {
            ...message,
            senderId: senderProfile.id,
            senderName: senderProfile.name,
            senderAvatar: senderProfile.avatarUrl,
            time: message.createdAt,
            seenBy: seenUsers,
            seenByText: buildSeenByText(seenUsers),
        };
    });
}

async function getMessageByIdEnriched(groupId, messageId) {
    const messageDoc = await groupsCollection.doc(groupId).collection("messages").doc(messageId).get();
    if (!messageDoc.exists) {
        return null;
    }

    const enriched = await enrichMessagesForUi(groupId, [messageDoc]);
    return enriched[0] || null;
}

function normalizeMemberIds(memberIds = [], ownerId) {
    const ids = Array.isArray(memberIds) ? memberIds : [];
    const uniqueIds = new Set(ids.filter(Boolean));
    if (ownerId) {
        uniqueIds.add(ownerId);
    }
    return Array.from(uniqueIds);
}

export async function getMemberById(groupId, userId) {
    const doc = await groupsCollection.doc(groupId).collection("members").doc(userId).get();
    if (!doc.exists) {
        return null;
    }
    return MemberModel.fromSnapshot(doc);
}

export async function listGroups() {
    const snapshot = await groupsCollection.get();
    const groups = snapshot.docs.map(GroupModel.fromSnapshot);

    const groupsWithLatestMessage = await Promise.all(
        groups.map(async (group) => {
            const latestMessageSnapshot = await groupsCollection
                .doc(group.id)
                .collection("messages")
                .orderBy("createdAt", "desc")
                .limit(1)
                .get();

            const latestMessage = latestMessageSnapshot.empty
                ? null
                : (await enrichMessagesForUi(group.id, latestMessageSnapshot.docs))[0] || null;

            return {
                ...group,
                latestMessage,
            };
        })
    );

    return groupsWithLatestMessage;
}

export async function getGroupById(groupId) {
    const doc = await groupsCollection.doc(groupId).get();
    if (!doc.exists) {
        return null;
    }
    return GroupModel.fromSnapshot(doc);
}

export async function updateGroup(groupId, payload = {}) {
    const updates = {};

    if (payload.groupName !== undefined) {
        updates.groupName = String(payload.groupName || "").trim();
    }

    if (payload.avatarUrl !== undefined) {
        updates.avatarUrl = String(payload.avatarUrl || "").trim();
    }

    if (Object.keys(updates).length === 0) {
        const error = new Error("at least one updatable field is required");
        error.statusCode = 400;
        throw error;
    }

    const docRef = groupsCollection.doc(groupId);
    await docRef.set(updates, { merge: true });
    const updated = await docRef.get();
    return GroupModel.fromSnapshot(updated);
}

export async function uploadAvatarForGroup(groupId, userId, fileBuffer) {
    if (!fileBuffer) {
        const error = new Error("avatar file is required");
        error.statusCode = 400;
        throw error;
    }

    const groupRef = groupsCollection.doc(groupId);
    const groupDoc = await groupRef.get();
    if (!groupDoc.exists) {
        const error = new Error("Group not found");
        error.statusCode = 404;
        throw error;
    }

    const uploaded = await uploadToCloudinary(fileBuffer, "avatar", userId, groupId);

    await groupRef.set(
        {
            avatarUrl: uploaded.secure_url,
        },
        { merge: true }
    );

    return {
        avatarUrl: uploaded.secure_url,
    };
}

export async function refreshInviteCode(groupId) {
    const groupRef = groupsCollection.doc(groupId);
    let resolvedInviteCode = "";

    await db.runTransaction(async (transaction) => {
        const groupDoc = await transaction.get(groupRef);

        if (!groupDoc.exists) {
            const error = new Error("Group not found");
            error.statusCode = 404;
            throw error;
        }

        for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt += 1) {
            const candidateCode = generateInviteCode();
            const duplicateSnapshot = await transaction.get(
                groupsCollection.where("inviteCode", "==", candidateCode).limit(1)
            );

            if (!duplicateSnapshot.empty) {
                continue;
            }

            transaction.set(groupRef, { inviteCode: candidateCode }, { merge: true });
            resolvedInviteCode = candidateCode;
            return;
        }

        const error = new Error("Failed to generate invite code");
        error.statusCode = 500;
        throw error;
    });

    return resolvedInviteCode;
}

export async function createGroup(payload) {
    const docRef = groupsCollection.doc();
    const group = new GroupModel({
        ...payload,
        inviteCode: String(payload.inviteCode || ""),
        createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.set(group.toFirestore());
    const created = await docRef.get();
    return GroupModel.fromSnapshot(created);
}

export async function createGroupWithMembers(payload) {
    const { groupName = "", avatarUrl = "", createdBy = "", memberIds = [] } = payload;
    const docRef = groupsCollection.doc();
    const groupId = docRef.id;
    const defaultPageRef = docRef.collection("scrapbookPages").doc();
    const selectedMemberIds = normalizeMemberIds(memberIds, createdBy).filter(
        (memberId) => memberId !== createdBy
    );

    const batch = db.batch();
    const group = new GroupModel({
        groupName,
        avatarUrl,
        inviteCode: "",
        createdBy,
        createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(docRef, group.toFirestore());

    const ownerMemberRef = docRef.collection("members").doc(createdBy);
    const ownerMember = new MemberModel({
        id: createdBy,
        role: "admin",
        joinedAt: FieldValue.serverTimestamp(),
    });
    batch.set(ownerMemberRef, ownerMember.toFirestore());

    const defaultPage = new ScrapbookPageModel({
        id: defaultPageRef.id,
        title: "Page 1",
        createdBy,
        createdAt: FieldValue.serverTimestamp(),
        templateId: null,
        backgroundColor: "#ffffff",
        backgroundImage: "",
    });
    batch.set(defaultPageRef, defaultPage.toFirestore());

    const ownerWidgetRef = usersCollection.doc(createdBy).collection("widgets").doc(groupId);
    batch.set(
        ownerWidgetRef,
        {
            groupId,
            pageId: defaultPageRef.id,
            latestPhotoUrl: "",
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    for (const invitedUserId of selectedMemberIds) {
        const inviteRef = docRef.collection("invitations").doc(invitedUserId);
        batch.set(
            inviteRef,
            {
                groupId,
                invitedUserId,
                invitedBy: createdBy,
                status: INVITATION_STATUS_PENDING,
                source: INVITATION_SOURCE_DIRECT,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    }

    await batch.commit();
    const created = await docRef.get();
    const createdDefaultPage = await defaultPageRef.get();
    const latestPage = ScrapbookPageModel.fromSnapshot(createdDefaultPage);

    return {
        ...GroupModel.fromSnapshot(created),
        latestPage,
        defaultPage: latestPage,
    };
}

export async function listMembers(groupId) {
    const snapshot = await groupsCollection.doc(groupId).collection("members").get();
    const members = snapshot.docs.map(MemberModel.fromSnapshot);

    if (members.length === 0) {
        return [];
    }

    const usersSnapshot = await Promise.all(
        members.map((member) => usersCollection.doc(member.id).get())
    );

    const userProfileMap = new Map(
        usersSnapshot
            .filter((doc) => doc.exists)
            .map((doc) => {
                const data = doc.data() || {};
                return [
                    doc.id,
                    {
                        username: data.username || "",
                        avatarUrl: data.avatarUrl || "",
                    },
                ];
            })
    );

    return members.map((member) => ({
        ...member,
        username: userProfileMap.get(member.id)?.username || "",
        avatarUrl: userProfileMap.get(member.id)?.avatarUrl || "",
    }));
}

export async function addOrUpdateMember(groupId, userId, payload) {
    const docRef = groupsCollection.doc(groupId).collection("members").doc(userId);
    const member = new MemberModel({
        id: userId,
        ...payload,
        joinedAt: payload.joinedAt ?? FieldValue.serverTimestamp(),
    });
    await docRef.set(member.toFirestore(), { merge: true });
    const updated = await docRef.get();
    return MemberModel.fromSnapshot(updated);
}

export async function addMemberAndWidget(groupId, userId, payload = {}) {
    const memberRef = groupsCollection.doc(groupId).collection("members").doc(userId);
    const widgetRef = usersCollection.doc(userId).collection("widgets").doc(groupId);
    const role = payload.role || "member";

    const batch = db.batch();
    const member = new MemberModel({
        id: userId,
        role,
        joinedAt: payload.joinedAt ?? FieldValue.serverTimestamp(),
    });

    batch.set(memberRef, member.toFirestore(), { merge: true });
    batch.set(
        widgetRef,
        {
            groupId,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    await batch.commit();
    const updated = await memberRef.get();
    return MemberModel.fromSnapshot(updated);
}

export async function createGroupInvitation(groupId, invitedUserId, invitedBy) {
    const inviteRef = groupsCollection
        .doc(groupId)
        .collection("invitations")
        .doc(invitedUserId);

    await inviteRef.set(
        {
            groupId,
            invitedUserId,
            invitedBy,
            status: INVITATION_STATUS_PENDING,
            source: INVITATION_SOURCE_DIRECT,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    const inviteDoc = await inviteRef.get();
    return { id: inviteDoc.id, ...inviteDoc.data() };
}

export async function listPendingInvitationsByUser(userId) {
    const invitesSnapshot = await db.collectionGroup("invitations").get();

    const pendingInvites = invitesSnapshot.docs
        .filter((doc) => doc.id === userId)
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((invite) => invite.status === INVITATION_STATUS_PENDING);

    const uniqueGroupIds = Array.from(new Set(pendingInvites.map((invite) => invite.groupId)));

    const groupDocs = await Promise.all(
        uniqueGroupIds.map((groupId) => groupsCollection.doc(groupId).get())
    );

    const groupMap = new Map(
        groupDocs
            .filter((doc) => doc.exists)
            .map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
    );

    return pendingInvites.map((invite) => ({
        ...invite,
        group: groupMap.get(invite.groupId) || null,
    }));
}

export async function respondToGroupInvitation(groupId, userId, action) {
    const inviteRef = groupsCollection
        .doc(groupId)
        .collection("invitations")
        .doc(userId);

    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists) {
        return null;
    }

    const invite = inviteDoc.data() || {};
    if (invite.status !== INVITATION_STATUS_PENDING) {
        return {
            id: inviteDoc.id,
            ...invite,
            alreadyResolved: true,
        };
    }

    const batch = db.batch();
    batch.set(
        inviteRef,
        {
            status: action,
            respondedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    if (action === INVITATION_STATUS_ACCEPTED) {
        const memberRef = groupsCollection.doc(groupId).collection("members").doc(userId);
        const member = new MemberModel({
            id: userId,
            role: "member",
            joinedAt: FieldValue.serverTimestamp(),
        });
        batch.set(memberRef, member.toFirestore(), { merge: true });

        const widgetRef = usersCollection.doc(userId).collection("widgets").doc(groupId);
        batch.set(
            widgetRef,
            {
                groupId,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    }

    await batch.commit();
    const updatedInvite = await inviteRef.get();
    return { id: updatedInvite.id, ...updatedInvite.data() };
}

export async function joinGroupByInviteCode(inviteCode, userId) {
    const normalizedInviteCode = String(inviteCode || "").trim().toUpperCase();

    if (!normalizedInviteCode || normalizedInviteCode.length !== INVITE_CODE_LENGTH) {
        const error = new Error("inviteCode is required");
        error.statusCode = 400;
        throw error;
    }

    const groupSnapshot = await groupsCollection
        .where("inviteCode", "==", normalizedInviteCode)
        .limit(1)
        .get();

    if (groupSnapshot.empty) {
        const error = new Error("Invite link is invalid");
        error.statusCode = 404;
        throw error;
    }

    const groupDoc = groupSnapshot.docs[0];
    const groupId = groupDoc.id;
    const groupRef = groupsCollection.doc(groupId);
    const memberRef = groupsCollection.doc(groupId).collection("members").doc(userId);
    const widgetRef = usersCollection.doc(userId).collection("widgets").doc(groupId);

    await db.runTransaction(async (transaction) => {
        const currentGroupDoc = await transaction.get(groupRef);
        if (!currentGroupDoc.exists) {
            const error = new Error("Group not found");
            error.statusCode = 404;
            throw error;
        }

        const currentInviteCode = String(currentGroupDoc.data()?.inviteCode || "").trim().toUpperCase();
        if (currentInviteCode !== normalizedInviteCode) {
            const error = new Error("Invite link is invalid");
            error.statusCode = 404;
            throw error;
        }

        const memberDoc = await transaction.get(memberRef);

        if (!memberDoc.exists) {
            const member = new MemberModel({
                id: userId,
                role: "member",
                joinedAt: FieldValue.serverTimestamp(),
            });
            transaction.set(memberRef, member.toFirestore(), { merge: true });
        }

        transaction.set(
            widgetRef,
            {
                groupId,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        transaction.set(
            groupRef,
            {
                inviteCode: "",
            },
            { merge: true }
        );
    });

    const group = GroupModel.fromSnapshot(groupDoc);
    return {
        groupId: group.id,
        groupName: group.groupName,
    };
}

export async function removeMemberAndWidget(groupId, userId) {
    const groupRef = groupsCollection.doc(groupId);
    const memberRef = groupsCollection.doc(groupId).collection("members").doc(userId);
    const widgetRef = usersCollection.doc(userId).collection("widgets").doc(groupId);

    const groupDoc = await groupRef.get();
    const groupData = groupDoc.exists ? (groupDoc.data() || {}) : {};
    const isOwnerLeaving = String(groupData.createdBy || "") === String(userId || "");

    const batch = db.batch();
    batch.delete(memberRef);
    batch.delete(widgetRef);
    await batch.commit();

    let ownershipTransferredTo = null;
    let groupDeleted = false;

    const remainingMembersSnapshot = await groupRef.collection("members").orderBy("joinedAt", "asc").get();

    if (remainingMembersSnapshot.empty) {
        await groupRef.delete();
        groupDeleted = true;
    } else if (isOwnerLeaving) {
        const newOwnerId = remainingMembersSnapshot.docs[0].id;
        await Promise.all([
            groupRef.set({ createdBy: newOwnerId }, { merge: true }),
            groupRef.collection("members").doc(newOwnerId).set({ role: "admin" }, { merge: true }),
        ]);
        ownershipTransferredTo = newOwnerId;
    }

    return {
        removed: true,
        groupId,
        userId,
        ownershipTransferredTo,
        groupDeleted,
    };
}

export async function listGroupsByMemberId(userId) {
    const membersSnapshot = await db.collectionGroup("members").get();

    const groupIds = new Set(
        membersSnapshot.docs
            .filter((doc) => doc.id === userId)
            .map((doc) => doc.ref.parent.parent?.id)
            .filter(Boolean)
    );

    const groupDocs = await Promise.all(
        Array.from(groupIds).map((groupId) => groupsCollection.doc(groupId).get())
    );

    return groupDocs.filter((doc) => doc.exists).map(GroupModel.fromSnapshot);
}

export async function listScrapbookPages(groupId) {
    const snapshot = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .get();
    return snapshot.docs.map(ScrapbookPageModel.fromSnapshot);
}

export async function createScrapbookPage(groupId, payload) {
    const docRef = groupsCollection.doc(groupId).collection("scrapbookPages").doc();
    const page = new ScrapbookPageModel({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.set(page.toFirestore());
    const created = await docRef.get();
    return ScrapbookPageModel.fromSnapshot(created);
}

export async function createScrapbookPageAndUpdateWidgets(groupId, payload) {
    const docRef = groupsCollection.doc(groupId).collection("scrapbookPages").doc();
    const page = new ScrapbookPageModel({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
    });

    const membersSnapshot = await groupsCollection.doc(groupId).collection("members").get();

    const batch = db.batch();
    batch.set(docRef, page.toFirestore());

    for (const memberDoc of membersSnapshot.docs) {
        const memberId = memberDoc.id;
        const widgetRef = usersCollection.doc(memberId).collection("widgets").doc(groupId);
        batch.set(
            widgetRef,
            {
                groupId,
                pageId: docRef.id,
                latestPhotoUrl: payload.latestPhotoUrl || "",
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    }

    await batch.commit();
    const created = await docRef.get();
    return ScrapbookPageModel.fromSnapshot(created);
}

export async function removePage(groupId, pageId) {
    const result = await groupsCollection.doc(groupId).collection("scrapbookPages").doc(pageId).delete();
    return result;
}

export async function listScrapbookItems(groupId, pageId) {
    const snapshot = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .doc(pageId)
        .collection("items")
        .get();
    return snapshot.docs.map(ScrapbookItemModel.fromSnapshot);
}

function normalizeTaggedUserIds(taggedUserIds = []) {
    if (!Array.isArray(taggedUserIds)) {
        return [];
    }

    return Array.from(
        new Set(
            taggedUserIds
                .map((userId) => String(userId || "").trim())
                .filter(Boolean)
        )
    );
}

function isOnThisDayFromPreviousYears(date, referenceDate = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return false;
    }

    const isMatch = (
        date.getUTCMonth() === referenceDate.getUTCMonth() &&
        date.getUTCDate() === referenceDate.getUTCDate() &&
        date.getUTCFullYear() < referenceDate.getUTCFullYear()
    );

    if (isMatch) {
        console.log(`[TODAY_MEMORY] isOnThisDay: MATCH - ${date.toISOString()} matches ${referenceDate.toISOString()} (month/day only)`);
    }

    return isMatch;
}

async function buildTaggedUsernameMap(userIds = []) {
    const uniqueUserIds = Array.from(new Set((userIds || []).filter(Boolean)));

    if (uniqueUserIds.length === 0) {
        return new Map();
    }

    const userDocs = await Promise.all(
        uniqueUserIds.map((userId) => usersCollection.doc(userId).get())
    );

    const usernameMap = new Map();
    for (const userDoc of userDocs) {
        if (!userDoc.exists) {
            continue;
        }

        const username = String(userDoc.data()?.username || "").trim();
        if (!username) {
            continue;
        }

        usernameMap.set(userDoc.id, username);
    }

    return usernameMap;
}

export async function listTodayMemoryItems(groupId, limit = TODAY_MEMORY_FALLBACK_LIMIT) {
    const pages = await listScrapbookPages(groupId);
    if (pages.length === 0) {
        console.log(`[TODAY_MEMORY] No pages found, returning empty`);
        return [];
    }

    const pageItems = await Promise.all(
        pages.map((page) => listScrapbookItems(groupId, page.id))
    );
    const totalItems = pageItems.flat().length;

    const taggedPhotoItems = pageItems
        .flat()
        .map((item) => {
            let dateString = null;

            if (item.createdAt) {
                const dateObj = typeof item.createdAt.toDate === 'function'
                    ? item.createdAt.toDate()
                    : new Date(item.createdAt);

                if (!isNaN(dateObj.getTime())) {
                    dateString = dateObj.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                }
            }
            console.log(`[TODAY_MEMORY] Processing item ${item.id}: type=${item.type}, createdAt=${dateString}, taggedUserIds=${JSON.stringify(item.taggedUserIds)}, photoUrl=${String(item.content?.photoUrl || "").trim()}`);

            return {
                item,
                taggedUserIds: normalizeTaggedUserIds(item.taggedUserIds),
                photoUrl: String(item.content?.photoUrl || "").trim(),
                createdAt: dateString 
            };
        })
        .filter(({ item, taggedUserIds, photoUrl }) => {
            const isPhoto = item.type === "photo";
            const hasTaggedUsers = taggedUserIds.length > 0;
            const hasPhotoUrl = Boolean(photoUrl);
            const shouldInclude = isPhoto && hasTaggedUsers && hasPhotoUrl;

            if (!shouldInclude) {
                console.log(`[TODAY_MEMORY] Filtering out item ${item.id}: type=${item.type}, taggedUsers=${taggedUserIds.length}, hasUrl=${hasPhotoUrl}`);
            }

            return shouldInclude;
        });

    if (taggedPhotoItems.length === 0) {
        return [];
    }

    const now = new Date();

    const onThisDayItems = taggedPhotoItems
        .filter(({ item }) => isOnThisDayFromPreviousYears(item.createdAt, now))
        .sort((left, right) => right.item.createdAt - left.item.createdAt);

    const candidateItems = (onThisDayItems.length > 0 ? onThisDayItems : taggedPhotoItems)
        .sort((left, right) => {
            const leftTime = left.item.createdAt instanceof Date ? left.item.createdAt.getTime() : 0;
            const rightTime = right.item.createdAt instanceof Date ? right.item.createdAt.getTime() : 0;
            return rightTime - leftTime;
        })
        .slice(0, Math.max(1, Number(limit) || TODAY_MEMORY_FALLBACK_LIMIT));

    console.log(`[TODAY_MEMORY] Using ${onThisDayItems.length > 0 ? '"on this day" mode' : 'fallback latest photos mode'}`);

    const usernameMap = await buildTaggedUsernameMap(
        candidateItems.flatMap(({ taggedUserIds }) => taggedUserIds)
    );

    const result = candidateItems
        .map(({ taggedUserIds, photoUrl, createdAt }) => ({
            taggedUsernames: taggedUserIds
                .map((userId) => usernameMap.get(userId))
                .filter(Boolean),
            photoUrl,
            createdAt,
        }))
        .filter((memoryItem) => memoryItem.taggedUsernames.length > 0);

    console.log(`[TODAY_MEMORY] Final result: ${result.length} memory items with valid usernames`);
    return result;
}

export async function getItemById(groupId, pageId, itemId) {
    const doc = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .doc(pageId)
        .collection("items")
        .doc(itemId)
        .get();
    if (!doc.exists) {
        return null;
    }
    return ScrapbookItemModel.fromSnapshot(doc)
}

export async function createScrapbookItem(groupId, pageId, payload) {
    try {
        // Upload content to Cloudinary first if file exists
        let parsedData = {};

        if (payload.payload && typeof payload.payload === 'string') {
            parsedData = JSON.parse(payload.payload);
        } else {
            parsedData = payload;
        }

        let processedPayload = {
            ...parsedData,
            content: {
                ...parsedData.content,
                ...(payload.content || {})
            }
        };

        if (processedPayload.content && processedPayload.content.file) {
            const cloudinaryResult = await uploadToCloudinary(
                processedPayload.content.file,
                processedPayload.type || "photo",
                processedPayload.createdBy,
                groupId
            );

            const { file, originalName, mimetype, ...contentWithoutFile } =
                processedPayload.content;
            processedPayload.content = {
                ...contentWithoutFile,
                photoUrl: cloudinaryResult.secure_url,
                cloudinaryPublicId: cloudinaryResult.public_id,
            };
        }

        // Handle face embeddings for automatic tagging
        let taggedUserIds = [];
        if (payload.faceEmbeddings) {
            console.log("Processing face embeddings for automatic tagging...");
            try {
                // Parse faceEmbeddings from form-data (stringified JSON)
                let embeddings = payload.faceEmbeddings;
                if (typeof embeddings === 'string') {
                    embeddings = JSON.parse(embeddings);
                }

                // Validate it's an array
                if (Array.isArray(embeddings)) {
                    taggedUserIds = await matchFaceEmbeddings(groupId, embeddings);
                }
            } catch (error) {
                console.warn("Warning: Failed to process face embeddings:", error.message);
                // Continue without face tagging
            }
        }

        const docRef = groupsCollection
            .doc(groupId)
            .collection("scrapbookPages")
            .doc(pageId)
            .collection("items")
            .doc();

        const item = new ScrapbookItemModel({
            ...processedPayload,
            taggedUserIds: taggedUserIds,
            createdAt: FieldValue.serverTimestamp(),
        });

        await docRef.set(item.toFirestore());
        const created = await docRef.get();
        return ScrapbookItemModel.fromSnapshot(created);
    } catch (error) {
        console.error("Error creating scrapbook item:", error);
        throw error;
    }
}

export async function listMessages(groupId) {
    const snapshot = await groupsCollection
        .doc(groupId)
        .collection("messages")
        .orderBy("createdAt", "asc")
        .get();
    return enrichMessagesForUi(groupId, snapshot.docs);
}

export async function createMessage(groupId, payload) {
    const docRef = groupsCollection.doc(groupId).collection("messages").doc();
    const message = new MessageModel({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.set(message.toFirestore());
    const created = await docRef.get();
    const enriched = await enrichMessagesForUi(groupId, [created]);
    const createdMessage = enriched[0] || MessageModel.fromSnapshot(created);
    publishGroupMessageEvent(groupId, "message.created", createdMessage);
    return createdMessage;
}

export async function markMessageSeen(groupId, messageId, userId, payload = {}) {
    const docRef = groupsCollection
        .doc(groupId)
        .collection("messages")
        .doc(messageId)
        .collection("seenBy")
        .doc(userId);

    const seenBy = new SeenByModel({
        id: userId,
        ...payload,
        seenAt: payload.seenAt ?? FieldValue.serverTimestamp(),
    });

    await docRef.set(seenBy.toFirestore(), { merge: true });
    const updated = await docRef.get();
    const updatedSeen = SeenByModel.fromSnapshot(updated);

    const profileMap = await getUserProfilesMap([userId]);
    const viewerProfile = profileMap.get(userId) || {
        id: userId,
        name: userId,
        avatarUrl: "",
    };

    const message = await getMessageByIdEnriched(groupId, messageId);
    if (message) {
        publishGroupMessageEvent(groupId, "message.seen", message);
    }

    return {
        id: updatedSeen.id,
        userId: updatedSeen.id,
        name: viewerProfile.name,
        avatarUrl: viewerProfile.avatarUrl,
        seenAt: updatedSeen.seenAt,
    };
}

export async function listItemReactions(groupId, pageId, itemId) {
    const snapshot = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .doc(pageId)
        .collection("items")
        .doc(itemId)
        .collection("reactions")
        .get();
    return snapshot.docs.map(ReactionModel.fromSnapshot);
}

export async function addReaction(groupId, pageId, itemId, payload) {
    const reaction = new ReactionModel({
        id: payload.id,
        type: payload.type,
    });
    const res = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .doc(pageId)
        .collection("items")
        .doc(itemId)
        .collection("reactions")
        .doc(reaction.id)
        .set(reaction.toFirestore());

    return res;
}

export async function removeReaction(groupId, pageId, itemId, userId) {
    const res = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .doc(pageId)
        .collection("items")
        .doc(itemId)
        .collection("reactions")
        .doc(userId)
        .delete();

    return res;
}

function generateInviteCode(length = INVITE_CODE_LENGTH) {
    let result = "";

    for (let index = 0; index < length; index += 1) {
        const randomIndex = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
        result += INVITE_CODE_ALPHABET[randomIndex];
    }

    return result;
}
