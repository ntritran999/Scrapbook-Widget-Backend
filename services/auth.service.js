import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";

import { db, firebaseApp } from "../firebaseConfig.js";

const usersCollection = db.collection("users");

function makeError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function firebaseRestErrorMessage(payload) {
    return payload?.error?.message || "Authentication failed";
}

export async function registerWithEmailAndPassword(payload) {
    const {
        email,
        password,
        displayName = "",
        username = "",
        nickname = "",
        avatarUrl = "",
        status = "active",
    } = payload;

    if (!email || !password) {
        throw makeError("email and password are required", 400);
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

export async function loginAndCreateCustomToken(payload) {
    const { email, password } = payload;

    if (!email || !password) {
        throw makeError("email and password are required", 400);
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
        throw makeError("FIREBASE_WEB_API_KEY is not configured", 500);
    }

    if (typeof fetch !== "function") {
        throw makeError("Global fetch is unavailable. Use Node.js 18+", 500);
    }

    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
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

    const result = await response.json();

    if (!response.ok) {
        const errorCode = result?.error?.message || "UNKNOWN";
        if (
            errorCode === "INVALID_PASSWORD" ||
            errorCode === "EMAIL_NOT_FOUND" ||
            errorCode === "INVALID_LOGIN_CREDENTIALS"
        ) {
            throw makeError("invalid email or password", 401);
        }

        throw makeError(firebaseRestErrorMessage(result), 400);
    }

    const uid = result.localId;
    const customToken = await getAuth(firebaseApp).createCustomToken(uid);

    return {
        uid,
        customToken,
    };
}