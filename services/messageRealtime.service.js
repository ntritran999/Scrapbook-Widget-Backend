import { WebSocket } from "ws";

const groupMessageSubscribers = new Map();
const userGroupListSubscribers = new Map();

function normalizeSubscriptionKey(value) {
    return String(value || "").trim();
}

function addSubscriber(subscriberMap, rawKey, socket) {
    const key = normalizeSubscriptionKey(rawKey);
    if (!key) {
        return () => {};
    }

    if (!subscriberMap.has(key)) {
        subscriberMap.set(key, new Set());
    }

    const subscribers = subscriberMap.get(key);
    subscribers.add(socket);

    return () => {
        const current = subscriberMap.get(key);
        if (!current) {
            return;
        }

        current.delete(socket);
        if (current.size === 0) {
            subscriberMap.delete(key);
        }
    };
}

function publishToSubscribers(subscriberMap, rawKey, event, payload) {
    const key = normalizeSubscriptionKey(rawKey);
    if (!key) {
        return;
    }

    const subscribers = subscriberMap.get(key);
    if (!subscribers || subscribers.size === 0) {
        return;
    }

    for (const socket of subscribers) {
        try {
            const sent = sendWebSocketEvent(socket, event, payload);
            if (!sent) {
                subscribers.delete(socket);
            }
        } catch {
            subscribers.delete(socket);
        }
    }

    if (subscribers.size === 0) {
        subscriberMap.delete(key);
    }
}

export function sendWebSocketEvent(socket, event, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    socket.send(
        JSON.stringify({
            event,
            data,
        })
    );
    return true;
}

export function subscribeToGroupMessages(groupId, socket) {
    return addSubscriber(groupMessageSubscribers, groupId, socket);
}

export function publishGroupMessageEvent(groupId, event, payload) {
    publishToSubscribers(groupMessageSubscribers, groupId, event, payload);
}

export function subscribeToUserGroupList(userId, socket) {
    return addSubscriber(userGroupListSubscribers, userId, socket);
}

export function publishUserGroupListEvent(userId, event, payload) {
    publishToSubscribers(userGroupListSubscribers, userId, event, payload);
}
