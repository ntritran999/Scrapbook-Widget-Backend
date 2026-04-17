# WebSocket Client Integration Guide

This guide explains how to connect clients to WebSocket realtime streams for group messages and group list updates.

## 1. Endpoint and Authentication

- Protocol: `ws` or `wss`
- Path: `/api/v1/groups/:groupId/messages/ws`
- Local example:
  - `ws://localhost:3000/api/v1/groups/<groupId>/messages/ws?token=<Firebase ID token>`

Authentication options:

- Browser-friendly: query string `token=<Firebase ID token>`
- Non-browser clients can also use `Authorization: Bearer <Firebase ID token>` during handshake

Notes:

- The authenticated user must be a member of the target group.
- If token is missing/invalid, handshake is rejected (`401`).
- If user is not a group member, handshake is rejected (`403`).

## 2. Event Contract

Every server message is JSON with this wrapper shape:

```json
{
  "event": "message.created",
  "data": {
    "id": "messageId"
  }
}
```

Server events:

- `stream.ready`: connection accepted.
- `messages.initial`: initial full message list.
- `message.created`: one newly created message.
- `message.seen`: one updated message after seen status changes.

## 3. Important Ordering Rule

Connection flow in backend is:

1. Register subscriber.
2. Emit `stream.ready`.
3. Fetch message list.
4. Emit `messages.initial`.

A real-time `message.created` may arrive before `messages.initial` in rare timing windows.

Client requirement:

- Do not assume strict ordering.
- Always deduplicate and merge messages by `id`.

## 4. Message Shape

`messages.initial`, `message.created`, and `message.seen` all use this enriched message shape:

```json
{
  "id": "messageId",
  "content": "Hello team",
  "createdBy": "senderUid",
  "createdAt": "2026-04-01T09:00:00.000Z",
  "type": "text",
  "senderId": "senderUid",
  "senderName": "John",
  "senderAvatar": "https://example.com/avatar.jpg",
  "time": "2026-04-01T09:00:00.000Z",
  "seenBy": [
    {
      "id": "viewerUid",
      "name": "Alice",
      "avatarUrl": "https://example.com/alice.jpg",
      "seenAt": "2026-04-01T09:01:20.000Z"
    }
  ],
  "seenByText": "Seen by Alice"
}
```

## 5. Web Client Example

```ts
function upsertMessage(list: any[], nextMessage: any) {
  const index = list.findIndex((m) => m.id === nextMessage.id);
  if (index === -1) {
    return [...list, nextMessage];
  }

  const next = [...list];
  next[index] = { ...next[index], ...nextMessage };
  return next;
}

export function connectGroupMessageSocket(params: {
  baseWsUrl: string;
  groupId: string;
  getIdToken: () => Promise<string>;
  onMessagesReplace: (messages: any[]) => void;
  onMessageUpsert: (message: any) => void;
  onStatus?: (status: string) => void;
}) {
  const {
    baseWsUrl,
    groupId,
    getIdToken,
    onMessagesReplace,
    onMessageUpsert,
    onStatus,
  } = params;

  let socket: WebSocket | null = null;
  let stopped = false;
  let retryMs = 1000;

  const connect = async () => {
    while (!stopped) {
      try {
        const idToken = await getIdToken();
        const url = `${baseWsUrl}/api/v1/groups/${groupId}/messages/ws?token=${encodeURIComponent(idToken)}`;

        onStatus?.("connecting");
        socket = new WebSocket(url);

        await new Promise<void>((resolve, reject) => {
          if (!socket) {
            reject(new Error("Socket not initialized"));
            return;
          }

          socket.onopen = () => {
            onStatus?.("connected");
            retryMs = 1000;
            resolve();
          };

          socket.onerror = () => {
            reject(new Error("WebSocket connection failed"));
          };
        });

        if (!socket) {
          continue;
        }

        await new Promise<void>((resolve) => {
          if (!socket) {
            resolve();
            return;
          }

          socket.onmessage = (raw) => {
            try {
              const packet = JSON.parse(String(raw.data || "{}"));
              const event = String(packet.event || "");
              const data = packet.data;

              if (event === "messages.initial" && Array.isArray(data)) {
                onMessagesReplace(data);
                return;
              }

              if (event === "message.created" || event === "message.seen") {
                onMessageUpsert(data);
              }
            } catch {
              // Ignore malformed messages
            }
          };

          socket.onclose = () => {
            resolve();
          };

          socket.onerror = () => {
            resolve();
          };
        });
      } catch {
        if (stopped) {
          return;
        }
      }

      if (stopped) {
        return;
      }

      onStatus?.("reconnecting");
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      retryMs = Math.min(retryMs * 2, 30000);
    }
  };

  connect();

  return () => {
    stopped = true;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    onStatus?.("stopped");
  };
}
```

## 6. Troubleshooting

- `401 Unauthorized`: Missing/invalid/expired Firebase ID token.
- `403 Only group members can access messages`: user is authenticated but not in the group.
- `404 Group not found`: invalid `groupId`.
- Duplicate messages in UI: switch to merge-by-id (`upsert`) logic.
- No updates after app resumed/backgrounded: reopen socket on app focus/resume and on network changes.

## 7. Client Checklist

- Use `/api/v1/groups/:groupId/messages/ws`.
- Pass Firebase ID token (query string or handshake header).
- Handle `stream.ready`, `messages.initial`, `message.created`, `message.seen`.
- Merge by message `id` to avoid duplicates/race issues.
- Reconnect with backoff for transient network errors.

## 8. Group List Stream (Latest Message Updates)

Use this stream to keep the group list in sync when `latestMessage` changes.

Endpoint:

- Path: `/api/v1/users/:userId/groups/ws`
- Local example:
  - `ws://localhost:3000/api/v1/users/<userId>/groups/ws?token=<Firebase ID token>`

Access rules:

- The Firebase token user must match `:userId`.

Events:

- `stream.ready`: connection accepted.
- `groups.initial`: initial list of groups for that user (same as `GET /users/:userId/groups`).
- `group.latest-message.updated`: one updated group object with the newest `latestMessage`.

Read-state fields on each group item:

- `lastSeenMessageId`: latest message id the current user has seen.
- `lastSeenAt`: latest seen timestamp of the current user.
- `unreadCount`: unread badge value for the current user.

Example packet:

```json
{
  "event": "group.latest-message.updated",
  "data": {
    "id": "groupId",
    "groupName": "My Scrapbook Group",
    "avatarUrl": "https://example.com/group.jpg",
    "createdBy": "userId",
    "createdAt": "2026-04-01T09:00:00.000Z",
    "lastSeenMessageId": "messageId",
    "lastSeenAt": "2026-04-01T09:10:30.000Z",
    "unreadCount": 2,
    "latestMessage": {
      "id": "messageId",
      "content": "Latest text",
      "createdBy": "senderUid",
      "createdAt": "2026-04-01T09:10:00.000Z",
      "type": "text"
    }
  }
}
```

Client merge strategy:

- On `groups.initial`: replace entire list.
- On `group.latest-message.updated`: upsert group by `id`.

Server update flow:

- On send message: sender `unreadCount` is reset to `0`; other members are incremented by `+1`.
- On mark-seen: current member updates `lastSeenMessageId`, `lastSeenAt`, and recalculates `unreadCount`.
