import { getAuth } from "firebase-admin/auth";

import { firebaseApp } from "../firebaseConfig.js";

function authError(message, statusCode = 401) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

export async function requireAuth(req, res, next) {
    try {
        const authorization = req.headers.authorization || "";

        if (!authorization.startsWith("Bearer ")) {
            throw authError("Missing or invalid Authorization header");
        }

        const idToken = authorization.slice("Bearer ".length).trim();
        if (!idToken) {
            throw authError("Missing ID token");
        }

        const decodedToken = await getAuth(firebaseApp).verifyIdToken(idToken);

        req.authUser = {
            uid: decodedToken.uid,
            email: decodedToken.email || null,
            name: decodedToken.name || null,
            picture: decodedToken.picture || null,
            claims: decodedToken,
        };

        return next();
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }

        const firebaseErrorCode = error?.code;
        if (
            firebaseErrorCode === "auth/id-token-expired" ||
            firebaseErrorCode === "auth/invalid-id-token" ||
            firebaseErrorCode === "auth/argument-error"
        ) {
            return res.status(401).json({ message: "Invalid or expired ID token" });
        }

        return res.status(401).json({ message: "Unauthorized" });
    }
}