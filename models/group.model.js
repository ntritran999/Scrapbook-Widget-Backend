import { normalizeTimestamp } from "./modelUtils.js";

export class MemberModel {
    constructor({ id = null, role = "member", joinedAt = null } = {}) {
        this.id = id;
        this.role = role;
        this.joinedAt = normalizeTimestamp(joinedAt);
    }

    static fromSnapshot(snapshot) {
        return new MemberModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            role: this.role,
            joinedAt: this.joinedAt,
        };
    }
}

export class GroupModel {
    constructor({
        id = null,
        groupName = "",
        avatarUrl = "",
        createdBy = "",
        createdAt = null,
    } = {}) {
        this.id = id;
        this.groupName = groupName;
        this.avatarUrl = avatarUrl;
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
            createdBy: this.createdBy,
            createdAt: this.createdAt,
        };
    }
}
