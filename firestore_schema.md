# Firestore Database Schema for Scrapbook Widget Backend

This document describes the Firestore collections and fields currently used by the backend implementation.

## 1. Users Collection

Path: `users/{userId}`

Fields:

- `username` (string): unique username
- `nickname` (string): display name
- `email` (string): user email
- `avatarUrl` (string): profile image URL
- `createdAt` (timestamp): account creation time
- `status` (string): usually `active` or `inactive`
- `faceVector` (number[192], optional): enrolled face embedding for automatic tagging
- `provider` (string, optional): currently set for Google sign-in users, e.g. `google.com`
- `lastLoginAt` (timestamp, optional): updated by Google login flow
- `isDeleted` (boolean, optional): soft-delete flag
- `deletedAt` (timestamp, optional): when the account was soft-deleted

Subcollection: `widgets/{groupId}`

- `latestPhotoUrl` (string)
- `senderAvatar` (string)
- `status` (string): latest widget status/caption snapshot; may also become `inactive` after account deletion cleanup
- `updatedAt` (timestamp)
- `groupId` (string)
- `pageId` (string)

Notes:

- The widget document id is now effectively `groupId`.
- Older code paths still refer to this id as `friendId` in route/service names for backward compatibility.

## 2. Groups Collection

Path: `groups/{groupId}`

Fields:

- `groupName` (string)
- `avatarUrl` (string)
- `inviteCode` (string): empty by default, generated on demand for invite-link join, then cleared after one successful join-by-link
- `createdBy` (string): owner/admin user id
- `createdAt` (timestamp)

Subcollection: `members/{userId}`

- `userId` (string): duplicated member id for easier collection-group reads
- `role` (string): `admin` or `member`
- `joinedAt` (timestamp)
- `lastSeenMessageId` (string | null): latest group message seen by this member
- `lastSeenAt` (timestamp | null): when this member last marked a group message as seen
- `unreadCount` (number): unread message badge count for this member

Subcollection: `invitations/{userId}`

- `groupId` (string)
- `invitedUserId` (string)
- `invitedBy` (string)
- `status` (string): `pending`, `accepted`, `declined`
- `source` (string): currently `direct`
- `createdAt` (timestamp)
- `updatedAt` (timestamp)
- `respondedAt` (timestamp, optional)

Behavior notes:

- Creating a group through the main flow also creates:
  - an owner member document at `groups/{groupId}/members/{createdBy}`
  - a default scrapbook page at `groups/{groupId}/scrapbookPages/{pageId}`
  - an owner widget at `users/{createdBy}/widgets/{groupId}`
- Default page values are:
  - `title = "Page 1"`
  - `templateId = null`
  - `backgroundColor = "#ffffff"`
  - `backgroundImage = ""`
- If the owner leaves and members remain, `createdBy` is transferred to the earliest remaining member and that member is promoted to `admin`.
- If the last member leaves, the group document is deleted.

## 3. Scrapbook Pages

Path: `groups/{groupId}/scrapbookPages/{pageId}`

Fields:

- `title` (string)
- `createdBy` (string)
- `createdAt` (timestamp)
- `templateId` (string | null)
- `backgroundColor` (string)
- `backgroundImage` (string)

Subcollection: `items/{itemId}`

- `type` (string): commonly `photo`, `sticker`, or `text`
- `createdBy` (string)
- `createdAt` (timestamp)
- `content` (map)
- `layout` (map)
- `taggedUserIds` (string[]): auto-populated from face matching when available

Subcollection: `items/{itemId}/reactions/{userId}`

- `type` (string)

Notes:

- Reaction document ids are the reacting user ids.
- Deleting a page currently deletes the page document only; nested subcollections are not explicitly cascaded by backend code.

## 4. Layout Object

Used by scrapbook items and template items.

- `x` (number): horizontal position
- `y` (number): vertical position
- `width` (number)
- `height` (number)
- `rotation` (number)
- `scale` (number)
- `zIndex` (number)

## 5. Item Content Object

The backend stores `content` as a flexible map. Common shapes:

Photo item:

- `photoUrl` (string)
- `caption` (string, optional)
- `cloudinaryPublicId` (string, optional): set when uploaded through backend

Sticker item:

- `stickerUrl` (string)

Text item:

- `text` (string)
- `fontSize` (number)
- `color` (string)

Notes:

- `content` is intentionally schema-flexible and may contain additional client-sent keys.
- The backend updates group widgets from photo item content:
  - `latestPhotoUrl` comes from `content.photoUrl`
  - widget `status` comes from `content.caption`

## 6. Templates Collection

Path: `templates/{templateId}`

Fields:

- `name` (string)
- `previewImage` (string)
- `category` (string)
- `createdAt` (timestamp)

Subcollection: `items/{itemId}`

- `type` (string)
- `layout` (map)
- `placeholder` (boolean)

## 7. Messages

Path: `groups/{groupId}/messages/{messageId}`

Fields:

- `content` (string)
- `createdBy` (string)
- `createdAt` (timestamp)
- `type` (string): currently `text` or `image`

Subcollection: `seenBy/{userId}`

- `seenAt` (timestamp)

Notes:

- On message creation, the sender also gets a `seenBy/{senderId}` document immediately.
- Message read state is duplicated onto `groups/{groupId}/members/{userId}` using `lastSeenMessageId`, `lastSeenAt`, and `unreadCount`.

## 8. App Config Collection

Path: `app_config/backgrounds`

Fields:

- `urls` (string[]): list of background image URLs returned by the backgrounds endpoint

## 9. Response-Only Fields vs Persisted Fields

The backend returns some computed fields that are not stored directly in Firestore documents.

Examples:

- Group API responses may include `latestMessage`, `role`, `joinedAt`, `lastSeenMessageId`, `lastSeenAt`, and `unreadCount` by combining group docs with member docs.
- Group creation responses may include `latestPage` and `defaultPage`; these are response aliases, not fields on `groups/{groupId}`.
- Message API and WebSocket responses may include enriched fields such as `senderId`, `senderName`, `senderAvatar`, `time`, `seenBy`, and `seenByText`.

## 10. Full Collection Hierarchy

```text
users
`-- {userId}
    `-- widgets
        `-- {groupId}

groups
`-- {groupId}
    |-- members
    |   `-- {userId}
    |-- invitations
    |   `-- {userId}
    |-- scrapbookPages
    |   `-- {pageId}
    |       `-- items
    |           `-- {itemId}
    |               `-- reactions
    |                   `-- {userId}
    `-- messages
        `-- {messageId}
            `-- seenBy
                `-- {userId}

templates
`-- {templateId}
    `-- items
        `-- {itemId}

app_config
`-- backgrounds
```
