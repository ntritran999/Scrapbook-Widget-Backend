const groupMessageSubscribers = new Map();

export function sendSseEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function subscribeToGroupMessages(groupId, res) {
    const key = String(groupId || "").trim();
    if (!groupMessageSubscribers.has(key)) {
        groupMessageSubscribers.set(key, new Set());
    }

    const subscribers = groupMessageSubscribers.get(key);
    subscribers.add(res);

    sendSseEvent(res, "stream.ready", {
        groupId: key,
        connectedAt: new Date().toISOString(),
    });

    return () => {
        const current = groupMessageSubscribers.get(key);
        if (!current) {
            return;
        }

        current.delete(res);
        if (current.size === 0) {
            groupMessageSubscribers.delete(key);
        }
    };
}

export function publishGroupMessageEvent(groupId, event, payload) {
    const key = String(groupId || "").trim();
    const subscribers = groupMessageSubscribers.get(key);
    if (!subscribers || subscribers.size === 0) {
        return;
    }

    for (const response of subscribers) {
        try {
            sendSseEvent(response, event, payload);
        } catch {
            subscribers.delete(response);
        }
    }

    if (subscribers.size === 0) {
        groupMessageSubscribers.delete(key);
    }
}
