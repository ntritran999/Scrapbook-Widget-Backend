import "dotenv/config"
import express from "express"
import cors from "cors"

import { testFirestoreConnection } from "./firebaseConfig.js";
import apiRoutes from "./routes/index.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function sanitizeHeaders(headers = {}) {
    const nextHeaders = { ...headers };
    if (nextHeaders.authorization) {
        nextHeaders.authorization = "Bearer ***";
    }
    return nextHeaders;
}

function sanitizeBody(body) {
    if (!body || typeof body !== "object") {
        return body;
    }

    const cloned = JSON.parse(JSON.stringify(body));
    if (cloned.password) {
        cloned.password = "***";
    }
    if (cloned.idToken) {
        cloned.idToken = "***";
    }
    if (cloned.refreshToken) {
        cloned.refreshToken = "***";
    }
    return cloned;
}

function shortenPayload(payload, maxLen = 1500) {
    try {
        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        if (!text) {
            return text;
        }
        return text.length > maxLen ? `${text.slice(0, maxLen)}...<truncated>` : text;
    } catch {
        return "<unserializable payload>";
    }
}

if (process.env.NODE_ENV !== "production") {
    app.use((req, res, next) => {
        const startedAt = Date.now();
        const requestId = Math.random().toString(36).slice(2, 10);

        let responsePayload;
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);

        res.json = (body) => {
            responsePayload = body;
            return originalJson(body);
        };

        res.send = (body) => {
            responsePayload = body;
            return originalSend(body);
        };

        const safeHeaders = sanitizeHeaders(req.headers);
        const safeBody = sanitizeBody(req.body);

        console.log(`[REQ ${requestId}] ${req.method} ${req.originalUrl}`);
        console.log(`[REQ ${requestId}] headers=${shortenPayload(safeHeaders, 1000)}`);
        console.log(`[REQ ${requestId}] query=${shortenPayload(req.query, 600)}`);
        console.log(`[REQ ${requestId}] body=${shortenPayload(safeBody, 1500)}`);

        res.on("finish", () => {
            const durationMs = Date.now() - startedAt;
            console.log(
                `[RES ${requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`
            );
            console.log(`[RES ${requestId}] body=${shortenPayload(responsePayload, 1500)}`);
        });

        next();
    });
}

const port = 3000;

app.get('/', (req, res) => {
    res.send('Hello world');
})

app.use("/api/v1", apiRoutes);

app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
    console.error(error);
    res.status(error?.statusCode || 500).json({
        message: error?.message || "Internal Server Error",
    });
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    testFirestoreConnection();
})