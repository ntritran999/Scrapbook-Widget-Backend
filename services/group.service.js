import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firebaseConfig.js";
import {
    GroupModel,
    MemberModel,
    MessageModel,
    ScrapbookItemModel,
    ScrapbookPageModel,
    SeenByModel,
} from "../models/index.js";
import { uploadToCloudinary } from "./cloudinary.service.js";

const groupsCollection = db.collection("groups");
const usersCollection = db.collection("users");

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

export async function listGroups() {
    const snapshot = await groupsCollection.get();
    return snapshot.docs.map(GroupModel.fromSnapshot);
}

export async function getGroupById(groupId) {
    const doc = await groupsCollection.doc(groupId).get();
    if (!doc.exists) {
        return null;
    }
    return GroupModel.fromSnapshot(doc);
}

export async function createGroup(payload) {
    const docRef = groupsCollection.doc();
    const group = new GroupModel({ ...payload, createdAt: FieldValue.serverTimestamp() });
    await docRef.set(group.toFirestore());
    const created = await docRef.get();
    return GroupModel.fromSnapshot(created);
}

export async function listMembers(groupId) {
    const snapshot = await groupsCollection.doc(groupId).collection("members").get();
    return snapshot.docs.map(MemberModel.fromSnapshot);
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

export async function listScrapbookItems(groupId, pageId) {
    const snapshot = await groupsCollection
        .doc(groupId)
        .collection("scrapbookPages")
        .doc(pageId)
        .collection("items")
        .get();
    return snapshot.docs.map(ScrapbookItemModel.fromSnapshot);
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
    const snapshot = await groupsCollection.doc(groupId).collection("messages").get();
    return snapshot.docs.map(MessageModel.fromSnapshot);
}

export async function createMessage(groupId, payload) {
    const docRef = groupsCollection.doc(groupId).collection("messages").doc();
    const message = new MessageModel({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.set(message.toFirestore());
    const created = await docRef.get();
    return MessageModel.fromSnapshot(created);
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
    return SeenByModel.fromSnapshot(updated);
}
