# Scrapbook Widget Backend API Docs

## Overview

This document describes the current REST API implemented in this backend.

- Server framework: Express
- Database: Firestore
- API prefix: `/api/v1`
- Default local base URL: `http://localhost:3000/api/v1`

Environment variables required for auth:

- Firebase Admin service account key file at `config/firebaseServiceAccountKey.json`
- `FIREBASE_WEB_API_KEY` for `POST /auth/login` (Firebase Identity Toolkit sign-in)

Environment variables required for media storage:

- `CLOUDINARY_CLOUD_NAME`: Cloudinary cloud name
- `CLOUDINARY_API_KEY`: Cloudinary API key

Health endpoint:

- `GET /` -> `Hello world`

## Quick Start

1. Start server:

```bash
node index.js
```

2. Import Postman files:

- Collection: `Scrapbook-Widget-Backend.postman_collection.json`
- Local env: `Scrapbook-Widget-Backend.local.postman_environment.json`
- Dev env: `Scrapbook-Widget-Backend.dev.postman_environment.json`
- Staging env: `Scrapbook-Widget-Backend.staging.postman_environment.json`

## Common Response Codes

- `400 Bad Request`: Validation error, missing required field, invalid upload payload
- `200 OK`: Successful read/update
- `201 Created`: Resource created
- `401 Unauthorized`: Missing/invalid/expired Firebase ID token
- `403 Forbidden`: Authenticated but not allowed to perform this action
- `404 Not Found`: Route or entity not found
- `409 Conflict`: Duplicate/conflicting state (e.g., username/member already exists)
- `504 Gateway Timeout`: Request timed out in backend timeout wrapper
- `500 Internal Server Error`: Unexpected server error

## Media Storage & Cloudinary Integration

All scrapbook items with file content (photos, images, etc.) are automatically uploaded to **Cloudinary** before being stored in the Firestore database. This ensures persistent and scalable media storage.

**File Upload Format**: Use `multipart/form-data` to upload image files. The Cloudinary integration automatically handles the upload and stores the URL in Firestore.

**Features**:

- Automatic file type detection and validation
- Quality optimization for images
- Organized folder structure in Cloudinary: `scrapbooks/{groupId}/{userId}/{itemType}`
- Public ID tracking for file identification and potential deletion
- Memory-efficient file handling using multer

**Supported Image Formats**: JPEG, JPG, PNG, GIF, WebP  
**Max File Size**: 50 MB

**Requirements**:

- `CLOUDINARY_CLOUD_NAME` environment variable must be set
- `CLOUDINARY_API_KEY` environment variable must be set

## Error Response Format

Most server errors follow:

```json
{
  "message": "Internal Server Error"
}
```

Entity-specific 404 examples:

```json
{
  "message": "User not found"
}
```

```json
{
  "message": "Group not found"
}
```

## Data Models

### User

```json
{
  "id": "string",
  "username": "string",
  "nickname": "string",
  "email": "string",
  "avatarUrl": "string",
  "createdAt": "date | null",
  "status": "active | inactive | string"
}
```

### Widget (`users/{userId}/widgets/{friendId}`)

```json
{
  "id": "friendId",
  "latestPhotoUrl": "string",
  "senderAvatar": "string",
  "status": "string",
  "updatedAt": "date | null",
  "groupId": "string",
  "pageId": "string"
}
```

### Group

```json
{
  "id": "string",
  "groupName": "string",
  "avatarUrl": "string",
  "createdBy": "userId",
  "createdAt": "date | null"
}
```

### Member (`groups/{groupId}/members/{userId}`)

```json
{
  "id": "userId",
  "role": "admin | member | string",
  "joinedAt": "date | null"
}
```

### Invitation (`groups/{groupId}/invitations/{userId}`)

```json
{
  "id": "userId",
  "groupId": "groupId",
  "invitedUserId": "userId",
  "invitedBy": "userId",
  "status": "pending | accepted | declined",
  "source": "direct",
  "createdAt": "date | null",
  "updatedAt": "date | null",
  "respondedAt": "date | null"
}
```

### Scrapbook Page (`groups/{groupId}/scrapbookPages/{pageId}`)

```json
{
  "id": "string",
  "title": "string",
  "createdBy": "userId",
  "createdAt": "date | null",
  "templateId": "string | null",
  "backgroundColor": "string",
  "backgroundImage": "string"
}
```

### Scrapbook Item (`groups/{groupId}/scrapbookPages/{pageId}/items/{itemId}`)

```json
{
  "id": "string",
  "type": "photo | sticker | text | string",
  "createdBy": "userId",
  "createdAt": "date | null",
  "content": {},
  "layout": {
    "x": 0,
    "y": 0,
    "width": 0,
    "height": 0,
    "rotation": 0,
    "scale": 1,
    "zIndex": 0
  }
}
```

### Item Reactions (`groups/{groupId}/scrapbookPages/{pageId}/items/{itemId}/reactions`)

```json
{
  "id": "string",
  "type": "string",
}
```

### Message (`groups/{groupId}/messages/{messageId}`)

```json
{
  "id": "string",
  "content": "string",
  "createdBy": "userId",
  "createdAt": "date | null",
  "type": "text | image | string"
}
```

### SeenBy (`groups/{groupId}/messages/{messageId}/seenBy/{userId}`)

```json
{
  "id": "userId",
  "seenAt": "date | null"
}
```

### Template (`templates/{templateId}`)

```json
{
  "id": "string",
  "name": "string",
  "previewImage": "string",
  "category": "string",
  "createdAt": "date | null"
}
```

### Template Item (`templates/{templateId}/items/{itemId}`)

```json
{
  "id": "string",
  "type": "string",
  "layout": {
    "x": 0,
    "y": 0,
    "width": 0,
    "height": 0,
    "rotation": 0,
    "scale": 1,
    "zIndex": 0
  },
  "placeholder": true
}
```

## Endpoints

## Authentication

### Register Flow (Android -> Node.js -> Firebase Auth)

### POST `/auth/register`

Create a Firebase Auth user and initialize profile data in Firestore.

Request body:

```json
{
  "email": "john@example.com",
  "password": "secret123",
  "displayName": "John Doe",
  "username": "john_doe",
  "nickname": "John",
  "avatarUrl": "https://example.com/avatar.jpg",
  "status": "active"
}
```

Response `201`:

```json
{
  "uid": "firebaseUid",
  "email": "john@example.com"
}
```

Response `400`:

```json
{
  "message": "email and password are required"
}
```

Response `409`:

```json
{
  "message": "email already exists"
}
```

### Login Flow (Android -> Firebase Auth -> ID Token -> Node.js)

Android should sign in directly with Firebase Auth `signInWithEmailAndPassword(email, password)`, then send Firebase ID token to backend.

### Login Flow (Android -> Node.js -> Firebase Auth)

If mobile app does not sign in with Firebase SDK directly, it can call backend login endpoint below using email/password.

### POST `/auth/login`

Sign in with Firebase email/password via Identity Toolkit and return tokens.

Request body:

```json
{
  "email": "john@example.com",
  "password": "secret123"
}
```

Response `200`:

```json
{
  "uid": "firebaseUid",
  "email": "john@example.com",
  "idToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "AE0u...",
  "expiresIn": 3600
}
```

Response `400`:

```json
{
  "message": "email and password are required"
}
```

Response `401`:

```json
{
  "message": "invalid email or password"
}
```

Response `403`:

```json
{
  "message": "account is inactive or deleted"
}
```

### POST `/auth/session`

Verify Firebase ID token and return authenticated session info.

Request body:

```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

Response `200`:

```json
{
  "uid": "firebaseUid",
  "email": "john@example.com",
  "name": "John Doe",
  "picture": "https://example.com/avatar.jpg",
  "session": {
    "valid": true,
    "authTime": 1711475082,
    "issuedAt": 1711475090,
    "expiresAt": 1711478690
  }
}
```

Response `400`:

```json
{
  "message": "idToken is required"
}
```

Response `401`:

```json
{
  "message": "invalid or expired idToken"
}
```

### POST `/auth/signout`

Revoke refresh tokens for the current user. Requires Authorization header.

Header:

```http
Authorization: Bearer <firebase_id_token>
```

Response `200`:

```json
{
  "uid": "firebaseUid",
  "signedOut": true,
  "tokensValidAfterTime": "2026-03-28T10:20:30.000Z"
}
```

Response `401`:

```json
{
  "message": "Missing or invalid Authorization header"
}
```

### DELETE `/auth/account`

Delete account with soft-delete first, then hard-delete Firebase Auth user.

Behavior:

- Soft delete profile in `users/{uid}`: set `status = inactive`, mark `isDeleted = true`, and apply default avatar/text placeholders.
- Transfer ownership for groups created by this user to an active member if possible.
- Remove this user from all group memberships and `seenBy` records.
- Anonymize author references in messages/scrapbook pages/scrapbook items with fallback text/image placeholders.
- Anonymize widgets pointing to this user to avoid broken UI context.
- Hard delete Firebase Auth account after cleanup.

Requires Authorization header.

Header:

```http
Authorization: Bearer <firebase_id_token>
```

Response `200`:

```json
{
  "uid": "firebaseUid",
  "softDeleted": true,
  "hardDeletedAuth": true,
  "placeholders": {
    "userAvatarUrl": "https://placehold.co/128x128?text=Deleted",
    "contentImageUrl": "https://placehold.co/600x400?text=Deleted+Content",
    "text": "[Content from deleted account]"
  },
  "cleanup": {
    "groupsOwnershipTransferred": 2,
    "membershipsRemoved": 4,
    "messagesAnonymized": 6,
    "messageSeenByRemoved": 7,
    "scrapbookPagesAnonymized": 3,
    "scrapbookItemsAnonymized": 10,
    "widgetsAnonymized": 5,
    "ownWidgetsRemoved": 2,
    "batchCommits": 1
  }
}
```

Response `401`:

```json
{
  "message": "Missing or invalid Authorization header"
}
```

Response `404`:

```json
{
  "message": "account not found"
}
```

## Authorization

All `/users`, `/groups`, `/templates`, `/auth/signout`, and `/auth/account` endpoints require Firebase ID token in Authorization header:

```http
Authorization: Bearer <firebase_id_token>
```

## Users

Profile security rules:

- `GET /users/:userId` and `PATCH /users/:userId` only allow self access (`:userId` must match Firebase token `uid`).
- `PATCH /users/:userId` allows partial update for: `nickname`, `username`, `avatarUrl`, `status`, `email`.
- If `email` is included in PATCH, it must match the email inside Firebase ID token.
- `username` must match: 3-20 chars, letters/numbers/underscore only (`^[a-zA-Z0-9_]{3,20}$`).

### GET `/users`

List all users.

Response `200`:

```json
[
  {
    "id": "userId",
    "username": "john_doe",
    "nickname": "John",
    "email": "john@example.com",
    "avatarUrl": "https://example.com/avatar.jpg",
    "createdAt": null,
    "status": "active"
  }
]
```

### GET `/users/discover`

List users for invite UI and exclude current authenticated user.

Query params:

- `q` (optional): search keyword matched against `username`, `nickname`, `email`

Response `200`: user array.

### GET `/users/:userId`

Get one user by id.

Path params:

- `userId`: user document id

Response `200`:

```json
{
  "id": "userId",
  "username": "john_doe",
  "nickname": "John",
  "email": "john@example.com",
  "avatarUrl": "https://example.com/avatar.jpg",
  "createdAt": null,
  "status": "active"
}
```

Response `404`:

```json
{
  "message": "User not found"
}
```

### GET `/users/:userId/groups`

List groups that the user is a member of.

Response includes `latestMessage` (or `null`) for each group.

Path params:

- `userId`: user document id

Response `200`:

```json
[
  {
    "id": "groupId",
    "groupName": "My Scrapbook Group",
    "avatarUrl": "https://example.com/group-avatar.jpg",
    "createdBy": "userId",
    "createdAt": null,
    "latestMessage": {
      "id": "messageId",
      "content": "Hello team",
      "createdBy": "senderUid",
      "createdAt": "2026-04-01T09:00:00.000Z",
      "type": "text"
    }
  }
]
```

Notes:

- Current implementation returns `[]` when user has no group/widgets.

### POST `/users`

Create user.

Request body:

```json
{
  "username": "john_doe",
  "nickname": "John",
  "email": "john@example.com",
  "avatarUrl": "https://example.com/avatar.jpg",
  "status": "active"
}
```

Response `201`: created user object.

### PATCH `/users/:userId`

Partially update user.

Request body example:

```json
{
  "nickname": "John Updated",
  "username": "john_updated",
  "avatarUrl": "https://example.com/new-avatar.jpg",
  "status": "active",
  "email": "john@example.com"
}
```

Response `200`: updated user object.

Response `400`:

```json
{
  "message": "username must be 3-20 characters and only contain letters, numbers, underscore"
}
```

Response `409`:

```json
{
  "message": "username already exists"
}
```

Response `403`:

```json
{
  "message": "forbidden"
}
```

### GET `/users/check-username?q=new_username`

Quickly check whether a username is available before saving profile changes.

Query params:

- `q`: username to check

Response `200` (available):

```json
{
  "available": true,
  "valid": true
}
```

Response `200` (taken):

```json
{
  "available": false,
  "valid": true
}
```

Response `200` (invalid format):

```json
{
  "available": false,
  "valid": false,
  "reason": "username must be 3-20 characters and only contain letters, numbers, underscore"
}
```

### POST `/users/avatar`

Upload avatar image using `multipart/form-data`, then update `users/{uid}.avatarUrl` for the authenticated user and return hosted URL.

Form-data fields:

- `file`: avatar image binary

Response `200`:

```json
{
  "avatarUrl": "https://..."
}
```

Response `404`:

```json
{
  "message": "User not found"
}
```

### GET `/users/:userId/widgets`

List widgets for a user.

Response `200`:

```json
[
  {
    "id": "friendId",
    "latestPhotoUrl": "https://example.com/photo.jpg",
    "senderAvatar": "https://example.com/sender.jpg",
    "status": "active",
    "updatedAt": null
  }
]
```

### PUT `/users/:userId/widgets/:friendId`

Create or update one widget for a given friend.

Request body:

```json
{
  "latestPhotoUrl": "https://example.com/photo.jpg",
  "senderAvatar": "https://example.com/sender.jpg",
  "status": "active"
}
```

Response `200`: widget object.

## Groups

### GET `/groups`

List all groups.

Response includes `latestMessage` (or `null`) for each group.

Response `200`:

```json
[
  {
    "id": "groupId",
    "groupName": "My Scrapbook Group",
    "avatarUrl": "https://example.com/group-avatar.jpg",
    "createdBy": "ownerUid",
    "createdAt": null,
    "latestMessage": {
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
  },
  {
    "id": "groupId2",
    "groupName": "Empty Group",
    "avatarUrl": "",
    "createdBy": "ownerUid",
    "createdAt": null,
    "latestMessage": null
  }
]
```

### GET `/groups/:groupId`

Get group by id.

Path params:

- `groupId`: group document id

Response `404`:

```json
{
  "message": "Group not found"
}
```

### POST `/groups`

Create a group.

Request body:

```json
{
  "groupName": "My Scrapbook Group",
  "avatarUrl": "https://example.com/group-avatar.jpg",
  "memberIds": ["userIdA", "userIdB"]
}
```

Behavior:

- `createdBy` is inferred from Firebase token (`req.authUser.uid`).
- Only owner is added immediately to `members` with role `admin`.
- Users in `memberIds` are created as `pending` invitations, not immediate members.
- System automatically creates one default scrapbook page for the new group:
  - `title`: `Page 1`
  - `templateId`: `null`
  - `backgroundColor`: `#ffffff`
  - `backgroundImage`: ``
- Owner widget is initialized with this default `pageId`.
- In response, this page is returned as `latestPage` (`defaultPage` is kept as backward-compatible alias).

Response `201`:

```json
{
  "id": "groupId",
  "groupName": "My Scrapbook Group",
  "avatarUrl": "https://example.com/group-avatar.jpg",
  "createdBy": "ownerUid",
  "createdAt": "2026-04-01T10:00:00.000Z",
  "latestPage": {
    "id": "pageId",
    "title": "Page 1",
    "createdBy": "ownerUid",
    "createdAt": "2026-04-01T10:00:00.000Z",
    "templateId": null,
    "backgroundColor": "#ffffff",
    "backgroundImage": ""
  },
  "defaultPage": {
    "id": "pageId",
    "title": "Page 1",
    "createdBy": "ownerUid",
    "createdAt": "2026-04-01T10:00:00.000Z",
    "templateId": null,
    "backgroundColor": "#ffffff",
    "backgroundImage": ""
  }
}
```

### PATCH `/groups/:groupId/name`

Edit group name.

Permissions:

- Any existing group member can update.

Request body:

```json
{
  "groupName": "New Group Name"
}
```

Response `200`: updated group object.

Response `400`:

```json
{
  "message": "groupName is required"
}
```

Response `400`:

```json
{
  "message": "groupName cannot be empty"
}
```

Response `403`:

```json
{
  "message": "Only group members can update group"
}
```

Response `404`:

```json
{
  "message": "Group not found"
}
```

### POST `/groups/:groupId/avatar`

Upload group avatar image using `multipart/form-data`, then update `groups/{groupId}.avatarUrl` and return hosted URL.

Permissions:

- Any existing group member can update.

Form-data fields:

- `file`: avatar image binary

Response `200`:

```json
{
  "avatarUrl": "https://..."
}
```

Response `400`:

```json
{
  "message": "avatar file is required"
}
```

Response `400` (invalid file type):

```json
{
  "message": "Only image files are allowed. Received: application/pdf"
}
```

Response `400` (file too large):

```json
{
  "message": "File is too large (max 50MB)"
}
```

Response `403`:

```json
{
  "message": "Only group members can update group"
}
```

Response `404`:

```json
{
  "message": "Group not found"
}
```

### GET `/groups/:groupId/members`

List members in group.

Response `200`:

```json
[
  {
    "id": "userId",
    "role": "admin",
    "joinedAt": null,
    "username": "john_doe",
    "avatarUrl": "https://example.com/avatar.jpg"
  }
]
```

### PUT `/groups/:groupId/members/:userId`

Add a user directly as member.

Permissions:

- Any existing group member can add.
- Owner cannot be added again.

Response `200`: member object.

### DELETE `/groups/:groupId/members/:userId`

Remove a member from group and delete corresponding widget.

Permissions:

- Admin only.
- Owner cannot be removed.

### POST `/groups/:groupId/leave`

Current user leaves group and own widget is deleted.

Rules:

- Owner can leave.
- If owner leaves and at least one member remains, ownership is transferred to the first remaining member.
- If no members remain after leaving, the group is deleted.

Response `200`:

```json
{
  "removed": true,
  "groupId": "groupId",
  "userId": "userId",
  "ownershipTransferredTo": "newOwnerUserId",
  "groupDeleted": false
}
```

When no ownership transfer happens, `ownershipTransferredTo` is `null`.
When no members remain after leave, `groupDeleted` is `true`.

### POST `/groups/:groupId/invitations`

Create or update pending invitation for a target user.

Request body:

```json
{
  "userId": "targetUserId"
}
```

Permissions:

- Any existing group member can invite.
- If target is already member -> `409`.

Response `201`: invitation object.

### GET `/groups/invitations/me`

List pending invitations for current authenticated user.

Response `200`: invitation array with attached `group` info.

### POST `/groups/:groupId/invitations/accept`

Accept my invitation to a group.

Behavior:

- Invitation status -> `accepted`
- Create `groups/{groupId}/members/{myId}` role `member`
- Create/update `users/{myId}/widgets/{groupId}`

### POST `/groups/:groupId/invitations/decline`

Decline my invitation to a group.

Behavior:

- Invitation status -> `declined`

### GET `/groups/:groupId/scrapbook-pages`

List scrapbook pages for group.

### POST `/groups/:groupId/scrapbook-pages`

Create scrapbook page.

Request body:

```json
{
  "title": "Weekend Memories",
  "templateId": "templateId",
  "backgroundColor": "#ffffff",
  "backgroundImage": ""
}
```

Behavior:

- `createdBy` is inferred from Firebase token.
- After page created, widgets of all group members are updated (`pageId`, `latestPhotoUrl`, `updatedAt`).

Response `201`: scrapbook page object.

### GET `/groups/:groupId/scrapbook-pages/:pageId/items`

List items in a scrapbook page.

### GET `/groups/:groupId/scrapbook-pages/:pageId/:itemId`

Get one item in a scrapbook page by item id.

Path params:

- `groupId`: group document id
- `pageId`: scrapbook page document id
- `itemId`: scrapbook item document id

Response `200`: scrapbook item object.

Response `404`:

```json
{
  "message": "Item not found"
}
```

### POST `/groups/:groupId/scrapbook-pages/:pageId/items`

Create item in page.

**Important**: Items are automatically uploaded to Cloudinary for persistent storage. When uploading with images/photos, use `multipart/form-data` with the image file. The file is automatically uploaded to Cloudinary and the URL is stored in the Firestore database.

**For Text Items** (JSON request):

Request body:

```json
{
  "type": "text",
  "createdBy": "userId",
  "content": {
    "text": "hello",
    "fontSize": 16,
    "color": "#111111"
  },
  "layout": {
    "x": 5,
    "y": 10,
    "width": 100,
    "height": 30,
    "rotation": 0,
    "scale": 1,
    "zIndex": 1
  }
}
```

**For Photo/Image Items** (multipart/form-data):

Use form-data with the following fields:

- `type`: "photo" (or "sticker")
- `createdBy`: userId (string)
- `file`: Image file (binary file - JPEG, PNG, GIF, WebP)
- `layout`: JSON object with positioning
- `content` (optional): Additional JSON properties for the content object

Example using curl:

```bash
curl -X POST "http://localhost:3000/api/v1/groups/groupId/scrapbook-pages/pageId/items" \
  -F "type=photo" \
  -F "createdBy=userId" \
  -F "file=@/path/to/image.jpg" \
  -F 'layout={"x":5,"y":10,"width":200,"height":150,"rotation":0,"scale":1,"zIndex":1}'
```

**Response `201`**: The `content.photoUrl` field contains the Cloudinary URL of the uploaded item.

Response example:

```json
{
  "id": "itemId",
  "type": "photo",
  "createdBy": "userId",
  "createdAt": "2024-01-15T10:30:00Z",
  "content": {
    "photoUrl": "https://res.cloudinary.com/your-cloud-name/image/upload/...",
    "cloudinaryPublicId": "scrapbooks/groupId/userId/photo/1705316400000"
  },
  "layout": {
    "x": 5,
    "y": 10,
    "width": 200,
    "height": 150,
    "rotation": 0,
    "scale": 1,
    "zIndex": 1
  }
}
```

**Supported Formats**: JPEG, JPG, PNG, GIF, WebP  
**Max File Size**: 50 MB

**Error Response `400`** (invalid file type):

```json
{
  "message": "Only image files are allowed. Received: application/pdf"
}
```

**Error Response `400`** (file too large):

```json
{
  "message": "File is too large (max 50MB)"
}
```

**Error Response `500`** (if Cloudinary is not configured):

```json
{
  "message": "Cloudinary environment variables are not configured"
}
```

**Error Response `500`** (if upload fails):

```json
{
  "message": "Failed to upload content to Cloudinary: [error details]"
}
```

### GET `/groups/:groupId/messages`

List group messages.

Response `200`:

```json
[
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
]
```

### GET `/groups/:groupId/messages/stream`

Real-time message stream using Server-Sent Events (SSE).

Permissions:

- Any existing group member can connect.

Headers:

```http
Accept: text/event-stream
Authorization: Bearer <firebase_id_token>
```

Connection notes:

- Keep the HTTP connection open.
- Server sends heartbeat comments periodically.
- Reconnect on disconnect from client side.

Events:

- `stream.ready`: stream connection established.
- `messages.initial`: initial full message list (same shape as `GET /groups/:groupId/messages`).
- `message.created`: a new created message object.
- `message.seen`: updated message object after seen status changes.

Example event payload (`message.created` / `message.seen`):

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

Response `403`:

```json
{
  "message": "Only group members can access messages"
}
```

Response `404`:

```json
{
  "message": "Group not found"
}
```

### POST `/groups/:groupId/messages`

Create message.

Request body:

```json
{
  "content": "Hello team",
  "createdBy": "userId",
  "type": "text"
}
```

Response `201`: created message object (same enriched shape as `GET /groups/:groupId/messages`).

### PUT `/groups/:groupId/messages/:messageId/seen-by/:userId`

Mark a message as seen by user.

Request body:

```json
{}
```

Response `200`:

```json
{
  "id": "viewerUid",
  "userId": "viewerUid",
  "name": "Alice",
  "avatarUrl": "https://example.com/alice.jpg",
  "seenAt": "2026-04-01T09:01:20.000Z"
}
```

## Templates

### GET `/templates`

List templates.

### POST `/templates`

Create template.

Request body:

```json
{
  "name": "Summer Template",
  "previewImage": "https://example.com/template-preview.jpg",
  "category": "seasonal"
}
```

Response `201`: template object.

### GET `/templates/:templateId/items`

List template items.

### POST `/templates/:templateId/items`

Create template item.

Request body:

```json
{
  "type": "photo",
  "layout": {
    "x": 0,
    "y": 0,
    "width": 200,
    "height": 120,
    "rotation": 0,
    "scale": 1,
    "zIndex": 1
  },
  "placeholder": true
}
```

Response `201`: template item object.

## cURL Examples

Create user:

```bash
curl -X POST "http://localhost:3000/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"john_doe",
    "nickname":"John",
    "email":"john@example.com",
    "avatarUrl":"https://example.com/avatar.jpg",
    "status":"active"
  }'
```

Get groups:

```bash
curl "http://localhost:3000/api/v1/groups"
```

Update group name:

```bash
curl -X PATCH "http://localhost:3000/api/v1/groups/<groupId>/name" \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "groupName": "Weekend Memories"
  }'
```

Upload group avatar:

```bash
curl -X POST "http://localhost:3000/api/v1/groups/<groupId>/avatar" \
  -H "Authorization: Bearer <firebase_id_token>" \
  -F "file=@/path/to/group-avatar.jpg"
```

## Notes

- Authentication endpoints are available under `/auth` for register/login.
- Input validation is minimal; malformed payloads may still be accepted.
- Timestamp fields are represented as `date | null` in API responses.
