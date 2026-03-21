import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firebaseConfig.js";
import { TemplateItemModel, TemplateModel } from "../models/index.js";

const templatesCollection = db.collection("templates");

export async function listTemplates() {
    const snapshot = await templatesCollection.get();
    return snapshot.docs.map(TemplateModel.fromSnapshot);
}

export async function createTemplate(payload) {
    const docRef = templatesCollection.doc();
    const template = new TemplateModel({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.set(template.toFirestore());
    const created = await docRef.get();
    return TemplateModel.fromSnapshot(created);
}

export async function listTemplateItems(templateId) {
    const snapshot = await templatesCollection.doc(templateId).collection("items").get();
    return snapshot.docs.map(TemplateItemModel.fromSnapshot);
}

export async function createTemplateItem(templateId, payload) {
    const docRef = templatesCollection.doc(templateId).collection("items").doc();
    const item = new TemplateItemModel(payload);
    await docRef.set(item.toFirestore());
    const created = await docRef.get();
    return TemplateItemModel.fromSnapshot(created);
}
