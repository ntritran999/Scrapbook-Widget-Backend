import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firebaseConfig.js";
import { UserModel, WidgetModel } from "../models/index.js";

import { listGroups, listMembers } from "./group.service.js";

const usersCollection = db.collection("users");

export async function listUsers() {
    const snapshot = await usersCollection.get();
    return snapshot.docs.map(UserModel.fromSnapshot);
}

export async function getUserById(userId) {
    const doc = await usersCollection.doc(userId).get();
    if (!doc.exists) {
        return null;
    }
    return UserModel.fromSnapshot(doc);
}

export async function getGroupsByUserId(userId) {
    const groups = []
    const all_groups = await listGroups();
    for (let i = 0; i < all_groups.length; i++) {
        const group = all_groups[i];
        const members = await listMembers(group.id);
        for (let j = 0; j < members.length; j++) {
            if (members[j].id == userId) {
                groups.push(group);
                break;
            }
        }
    }
    return groups;
}

export async function createUser(payload) {
    const docRef = usersCollection.doc();
    const user = new UserModel({ ...payload, createdAt: FieldValue.serverTimestamp() });
    await docRef.set(user.toFirestore());
    const created = await docRef.get();
    return UserModel.fromSnapshot(created);
}

export async function updateUser(userId, payload) {
    const docRef = usersCollection.doc(userId);
    await docRef.set(payload, { merge: true });
    const updated = await docRef.get();
    return UserModel.fromSnapshot(updated);
}

export async function listUserWidgets(userId) {
    const snapshot = await usersCollection.doc(userId).collection("widgets").get();
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
