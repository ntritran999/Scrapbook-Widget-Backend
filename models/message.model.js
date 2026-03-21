import { normalizeTimestamp } from "./modelUtils.js";

export class SeenByModel {
    constructor({ id = null, seenAt = null } = {}) {
        this.id = id;
        this.seenAt = normalizeTimestamp(seenAt);
    }

    static fromSnapshot(snapshot) {
        return new SeenByModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            seenAt: this.seenAt,
        };
    }
}

export class MessageModel {
    constructor({
        id = null,
        content = "",
        createdBy = "",
        createdAt = null,
        type = "text",
    } = {}) {
        this.id = id;
        this.content = content;
        this.createdBy = createdBy;
        this.createdAt = normalizeTimestamp(createdAt);
        this.type = type;
    }

    static fromSnapshot(snapshot) {
        return new MessageModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            content: this.content,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
            type: this.type,
        };
    }
}
