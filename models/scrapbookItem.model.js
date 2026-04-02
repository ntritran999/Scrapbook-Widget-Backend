import { LayoutModel } from "./layout.model.js";
import { normalizeTimestamp } from "./modelUtils.js";

export class ScrapbookItemModel {
    constructor({
        id = null,
        type = "photo",
        createdBy = "",
        createdAt = null,
        content = {},
        layout = {},
        taggedUserIds = [],
    } = {}) {
        this.id = id;
        this.type = type;
        this.createdBy = createdBy;
        this.createdAt = normalizeTimestamp(createdAt);
        this.content = content;
        this.layout = LayoutModel.fromFirestore(layout);
        this.taggedUserIds = taggedUserIds;
    }

    static fromSnapshot(snapshot) {
        return new ScrapbookItemModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            type: this.type,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
            content: this.content,
            layout: this.layout.toFirestore(),
            taggedUserIds: this.taggedUserIds,
        };
    }
}
