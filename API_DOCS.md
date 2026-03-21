# Scrapbook Widget Backend API Docs

## Overview

This document describes the current REST API implemented in this backend.

- Server framework: Express
- Database: Firestore
- API prefix: `/api/v1`
- Default local base URL: `http://localhost:3000/api/v1`

Environment variables required for auth:

- `FIREBASE_WEB_API_KEY`: Firebase Web API key used by backend to verify email/password login

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

- `200 OK`: Successful read/update
- `201 Created`: Resource created
- `404 Not Found`: Route or entity not found
- `500 Internal Server Error`: Unexpected server error

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
  "updatedAt": "date | null"
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

### Login Flow (Android -> Node.js -> Firebase Auth verify -> custom token -> Android)

### POST `/auth/login`

Verify email/password against Firebase Auth using Identity Toolkit API, then return Firebase custom token.

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
  "customToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

Response `401`:

```json
{
  "message": "invalid email or password"
}
```

Android should then call Firebase Auth `signInWithCustomToken(customToken)`.

## Users

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
  "avatarUrl": "https://example.com/new-avatar.jpg"
}
```

Response `200`: updated user object.

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
  "createdBy": "userId"
}
```

Response `201`: group object.

### GET `/groups/:groupId/members`

List members in group.

### PUT `/groups/:groupId/members/:userId`

Add or update a group member.

Request body:

```json
{
  "role": "member"
}
```

Response `200`: member object.

### GET `/groups/:groupId/scrapbook-pages`

List scrapbook pages for group.

### POST `/groups/:groupId/scrapbook-pages`

Create scrapbook page.

Request body:

```json
{
  "title": "Weekend Memories",
  "createdBy": "userId",
  "templateId": "templateId",
  "backgroundColor": "#ffffff",
  "backgroundImage": ""
}
```

Response `201`: scrapbook page object.

### GET `/groups/:groupId/scrapbook-pages/:pageId/items`

List items in a scrapbook page.

### POST `/groups/:groupId/scrapbook-pages/:pageId/items`

Create item in page.

Request body (text item):

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

Response `201`: scrapbook item object.

### GET `/groups/:groupId/messages`

List group messages.

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

Response `201`: message object.

### PUT `/groups/:groupId/messages/:messageId/seen-by/:userId`

Mark a message as seen by user.

Request body:

```json
{}
```

Response `200`: seenBy object.

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

## Notes

- Authentication endpoints are available under `/auth` for register/login.
- Input validation is minimal; malformed payloads may still be accepted.
- Timestamp fields are represented as `date | null` in API responses.
