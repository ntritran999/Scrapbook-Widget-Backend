import { normalizeTimestamp } from "./modelUtils.js";

export class MemberModel {
    constructor({
        id = null,
        userId = null,
        role = "member",
        joinedAt = null,
        lastSeenMessageId = null,
        lastSeenAt = null,
        unreadCount = 0,
    } = {}) {
        this.id = id;
        this.userId = String(userId || id || "").trim() || null;
        this.role = role;
        this.joinedAt = normalizeTimestamp(joinedAt);
        this.lastSeenMessageId = String(lastSeenMessageId || "").trim() || null;
        this.lastSeenAt = normalizeTimestamp(lastSeenAt);
        this.unreadCount = Number.isFinite(Number(unreadCount))
            ? Math.max(0, Number(unreadCount))
            : 0;
    }

    static fromSnapshot(snapshot) {
        return new MemberModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            userId: this.userId,
            role: this.role,
            joinedAt: this.joinedAt,
            lastSeenMessageId: this.lastSeenMessageId,
            lastSeenAt: this.lastSeenAt,
            unreadCount: this.unreadCount,
        };
    }
}

export class GroupModel {
    constructor({
        id = null,
        groupName = "",
        avatarUrl = "",
        inviteCode = "",
        createdBy = "",
        createdAt = null,
    } = {}) {
        this.id = id;
        this.groupName = groupName;
        this.avatarUrl = avatarUrl;
        this.inviteCode = String(inviteCode || "");
        this.createdBy = createdBy;
        this.createdAt = normalizeTimestamp(createdAt);
    }

    static fromSnapshot(snapshot) {
        return new GroupModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            groupName: this.groupName,
            avatarUrl: this.avatarUrl,
            inviteCode: this.inviteCode,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
        };
    }
}
