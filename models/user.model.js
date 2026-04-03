import { normalizeTimestamp } from "./modelUtils.js";

export class WidgetModel {
    constructor({
        id = null,
        latestPhotoUrl = "",
        senderAvatar = "",
        status = "",
        updatedAt = null,
        groupId = "",
        pageId = "",
    } = {}) {
        this.id = id;
        this.latestPhotoUrl = latestPhotoUrl;
        this.senderAvatar = senderAvatar;
        this.status = status;
        this.updatedAt = normalizeTimestamp(updatedAt);
        this.groupId = groupId;
        this.pageId = pageId;
    }

    static fromSnapshot(snapshot) {
        return new WidgetModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            latestPhotoUrl: this.latestPhotoUrl,
            senderAvatar: this.senderAvatar,
            status: this.status,
            updatedAt: this.updatedAt,
            groupId: this.groupId,
            pageId: this.pageId,
        };
    }
}

export class UserModel {
    constructor({
        id = null,
        username = "",
        nickname = "",
        email = "",
        avatarUrl = "",
        createdAt = null,
        status = "active",
        faceVector = null,
    } = {}) {
        this.id = id;
        this.username = username;
        this.nickname = nickname;
        this.email = email;
        this.avatarUrl = avatarUrl;
        this.createdAt = normalizeTimestamp(createdAt);
        this.status = status;
        this.faceVector = faceVector;
    }

    static fromSnapshot(snapshot) {
        return new UserModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            username: this.username,
            nickname: this.nickname,
            email: this.email,
            avatarUrl: this.avatarUrl,
            createdAt: this.createdAt,
            status: this.status,
            ...(this.faceVector && { faceVector: this.faceVector }),
        };
    }
}
