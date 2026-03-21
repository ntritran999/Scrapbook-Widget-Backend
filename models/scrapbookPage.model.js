import { normalizeTimestamp } from "./modelUtils.js";

export class ScrapbookPageModel {
    constructor({
        id = null,
        title = "",
        createdBy = "",
        createdAt = null,
        templateId = null,
        backgroundColor = "",
        backgroundImage = "",
    } = {}) {
        this.id = id;
        this.title = title;
        this.createdBy = createdBy;
        this.createdAt = normalizeTimestamp(createdAt);
        this.templateId = templateId;
        this.backgroundColor = backgroundColor;
        this.backgroundImage = backgroundImage;
    }

    static fromSnapshot(snapshot) {
        return new ScrapbookPageModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            title: this.title,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
            templateId: this.templateId,
            backgroundColor: this.backgroundColor,
            backgroundImage: this.backgroundImage,
        };
    }
}
