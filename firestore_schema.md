Firestore Database Schema for Scrapbook Widget App

1. Users Collection
   Path: users/{userId}

Fields:

- username (string): unique username
- nickname (string): display name
- email (string): user email
- avatarUrl (string): profile image URL
- createdAt (timestamp): account creation time
- status (string): active / inactive

Subcollection:
widgets/{friendId}

- latestPhotoUrl (string)
- senderAvatar (string)
- status (string)
- updatedAt (timestamp)
- groupId (string)
- pageId (string)

Note:

- For group widgets, `friendId` is currently used as `groupId` document id in API implementation.

2. Groups Collection
   Path: groups/{groupId}

Fields:

- groupName (string)
- avatarUrl (string)
- createdBy (string)
- createdAt (timestamp)

Subcollection:
members/{userId}

- role (string): admin / member
- joinedAt (timestamp)

Subcollection:
invitations/{userId}

- groupId (string)
- invitedUserId (string)
- invitedBy (string)
- status (string): pending / accepted / declined
- source (string): direct
- createdAt (timestamp)
- updatedAt (timestamp)
- respondedAt (timestamp, optional)

Behavior Notes:

- When creating a group, system auto-creates one default scrapbook page in
  `groups/{groupId}/scrapbookPages/{pageId}` with:
  - title = `Page 1`
  - templateId = `null`
  - backgroundColor = `#ffffff`
  - backgroundImage = ``
- Owner widget `users/{ownerId}/widgets/{groupId}` is initialized with this `pageId`.
- If owner leaves group and there is at least one remaining member, `groups/{groupId}.createdBy`
  is transferred to the first remaining member.
- If the last member leaves, `groups/{groupId}` is deleted.

3. Scrapbook Pages
   Path: groups/{groupId}/scrapbookPages/{pageId}

Fields:

- title (string)
- createdBy (string)
- createdAt (timestamp)
- templateId (string, optional)
- backgroundColor (string)
- backgroundImage (string)

Subcollection:
items/{itemId}

- type (string): photo / sticker / text
- createdBy (string)
- createdAt (timestamp)
- content (map)
- layout (map)

Subcollection:
items/{itemId}/reactions/{userId}

- type (string)

4. Layout Object
   Map structure for item placement on canvas:

- x (number): horizontal position
- y (number): vertical position
- width (number)
- height (number)
- rotation (number)
- scale (number)
- zIndex (number)

5. Content Object Examples
   Photo item:

- photoUrl (string)
- caption (string)

Note:

- API response fields like `latestPage` / `defaultPage` are response-level aliases.
  They are not persisted as fields in `groups/{groupId}` documents.

Sticker item:

- stickerUrl (string)

Text item:

- text (string)
- fontSize (number)
- color (string)

6. Templates Collection
   Path: templates/{templateId}

Fields:

- name (string)
- previewImage (string)
- category (string)
- createdAt (timestamp)

Subcollection:
items/{itemId}

- type (string)
- layout (map)
- placeholder (boolean)

7. Messages (Group Chat)
   Path: groups/{groupId}/messages/{messageId}

Fields:

- content (string)
- createdBy (string)
- createdAt (timestamp)
- type (string): text / image

Subcollection:
seenBy/{userId}

- seenAt (timestamp)

8. Full Collection Hierarchy
   users
   └── userId
   ├── username
   ├── nickname
   ├── email
   ├── avatarUrl
   ├── createdAt
   ├── status
   └── widgets
   └── friendId

groups
└── groupId
├── groupName
├── avatarUrl
├── createdBy
├── createdAt
├── members
│ └── userId
├── invitations
│ └── userId
├── scrapbookPages
│ └── pageId
│ └── items
│ └── itemId
└── messages
└── messageId
└── seenBy
└── userId

templates
└── templateId
└── items
└── itemId
