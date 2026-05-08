import "dotenv/config"
import "./utils/console-output.js";
import http from "http"
import express from "express"
import cors from "cors"
import { WebSocketServer } from "ws"
import { getAuth } from "firebase-admin/auth"

import { firebaseApp, testFirestoreConnection } from "./firebaseConfig.js";
import apiRoutes from "./routes/index.js";
import { getGroupById, getMemberById, listMessages } from "./services/group.service.js";
import { getGroupsByUserId } from "./services/user.service.js";
import {
    sendWebSocketEvent,
    subscribeToGroupMessages,
    subscribeToUserGroupList,
} from "./services/messageRealtime.service.js";

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

function isNotificationLogRequest(req) {
    const path = String(req.originalUrl || "");
    return path.includes("/device-token");
}

if (process.env.NODE_ENV !== "production") {
    app.use((req, res, next) => {
        if (!isNotificationLogRequest(req)) {
            next();
            return;
        }

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

const GROUP_MESSAGE_WS_PATH = /^\/api\/v1\/groups\/([^/]+)\/messages\/ws\/?$/;
const USER_GROUP_LIST_WS_PATH = /^\/api\/v1\/users\/([^/]+)\/groups\/ws\/?$/;

function statusText(statusCode) {
    if (statusCode === 401) {
        return "Unauthorized";
    }
    if (statusCode === 403) {
        return "Forbidden";
    }
    if (statusCode === 404) {
        return "Not Found";
    }
    return "Bad Request";
}

function rejectUpgrade(socket, statusCode, message) {
    socket.on('error', (err) => {
        console.error(`[WS] Socket error during upgrade rejection: ${statusCode}`, err.message);
    });
    socket.write(
        `HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\n` +
            "Connection: close\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n\r\n" +
            `${message}`
    );
    socket.destroy();
}

function extractWebSocketToken(req, requestUrl) {
    const queryToken = String(requestUrl.searchParams.get("token") || "").trim();
    if (queryToken) {
        return queryToken;
    }

    const authorization = String(req.headers.authorization || "");
    if (authorization.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length).trim();
    }

    return "";
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (socket, context = {}) => {
    const channel = String(context.channel || "group-messages");
    const groupId = String(context.groupId || "");
    const userId = String(context.userId || "");

    socket.isAlive = true;
    socket.on("pong", () => {
        socket.isAlive = true;
    });

    const unsubscribe =
        channel === "user-groups"
            ? subscribeToUserGroupList(userId, socket)
            : subscribeToGroupMessages(groupId, socket);

    socket.on("close", () => {
        unsubscribe();
    });

    socket.on("error", () => {
        unsubscribe();
    });

    sendWebSocketEvent(socket, "stream.ready", {
        channel,
        groupId,
        userId,
        connectedAt: new Date().toISOString(),
    });

    try {
        if (channel === "user-groups") {
            const initialGroups = await getGroupsByUserId(userId);
            sendWebSocketEvent(socket, "groups.initial", initialGroups);
            return;
        }

        const initialMessages = await listMessages(groupId);
        sendWebSocketEvent(socket, "messages.initial", initialMessages);
    } catch (error) {
        if (channel === "user-groups") {
            console.error(`[WS] Failed to load initial groups for user ${userId}`, error);
        } else {
            console.error(`[WS] Failed to load initial messages for group ${groupId}`, error);
        }

        sendWebSocketEvent(socket, "stream.error", {
            message: channel === "user-groups"
                ? "Failed to load initial groups"
                : "Failed to load initial messages",
        });
    }
});

const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
        if (client.isAlive === false) {
            client.terminate();
            continue;
        }

        client.isAlive = false;
        client.ping();
    }
}, 25000);

server.on("upgrade", async (req, socket, head) => {
    let requestUrl;
    try {
        requestUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    } catch {
        rejectUpgrade(socket, 400, "Malformed WebSocket URL");
        return;
    }

    const groupMessagePathMatch = requestUrl.pathname.match(GROUP_MESSAGE_WS_PATH);
    const userGroupListPathMatch = requestUrl.pathname.match(USER_GROUP_LIST_WS_PATH);

    if (!groupMessagePathMatch && !userGroupListPathMatch) {
        rejectUpgrade(socket, 404, "WebSocket endpoint not found");
        return;
    }

    const groupId = groupMessagePathMatch ? decodeURIComponent(groupMessagePathMatch[1] || "") : "";
    const targetUserId = userGroupListPathMatch
        ? decodeURIComponent(userGroupListPathMatch[1] || "")
        : "";
    const idToken = extractWebSocketToken(req, requestUrl);

    if (!idToken) {
        rejectUpgrade(socket, 401, "Missing Firebase ID token");
        return;
    }

    let decodedToken;
    try {
        decodedToken = await getAuth(firebaseApp).verifyIdToken(idToken);
    } catch {
        rejectUpgrade(socket, 401, "Invalid or expired Firebase ID token");
        return;
    }

    if (groupMessagePathMatch) {
        try {
            const group = await getGroupById(groupId);
            if (!group) {
                rejectUpgrade(socket, 404, "Group not found");
                return;
            }

            const requesterMember = await getMemberById(groupId, decodedToken.uid);
            if (!requesterMember) {
                rejectUpgrade(socket, 403, "Only group members can access messages");
                return;
            }
        } catch (error) {
            console.error("[WS] Upgrade validation failed", error);
            rejectUpgrade(socket, 400, "WebSocket validation failed");
            return;
        }

        wss.handleUpgrade(req, socket, head, (client) => {
            wss.emit("connection", client, {
                channel: "group-messages",
                groupId,
                userId: decodedToken.uid,
            });
        });

        return;
    }

    if (decodedToken.uid !== targetUserId) {
        rejectUpgrade(socket, 403, "Only the authenticated user can access this group list stream");
        return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, {
            channel: "user-groups",
            userId: decodedToken.uid,
        });
    });
});

server.on("close", () => {
    clearInterval(wsHeartbeat);
});

server.listen(port, () => {
    console.log(`Listening on port ${port}`);
    testFirestoreConnection();
})
