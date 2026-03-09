import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceAccountPath = path.join(
    __dirname,
    "config",
    "firebaseServiceAccountKey.json"
);

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
const firestoreDatabaseId =
    process.env.FIRESTORE_DATABASE_ID;

export const firebaseApp =
    getApps().length > 0
        ? getApps()[0]
        : initializeApp({
                credential: cert(serviceAccount),
            });

export const db = getFirestore(firebaseApp, firestoreDatabaseId);

export async function testFirestoreConnection() {
    try {
        const docRef = db.collection("server_logs").doc("init");
        await docRef.set(
            {
                status: "Server connected successfully",
                timestamp: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        console.log(
            `Successfully connected to Firebase database: ${firestoreDatabaseId}`
        );
    } catch (error) {
        console.error("Error connecting to Firebase:", error);
    }
}