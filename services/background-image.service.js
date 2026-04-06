import { db } from "../firebaseConfig.js";

export async function listBackgroundImages() {
    const doc = await db.collection("app_config").doc("backgrounds").get();
    if (!doc.exists) {
        return null;
    }

    return doc.data().urls;
}