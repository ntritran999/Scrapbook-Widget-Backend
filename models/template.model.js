import { LayoutModel } from "./layout.model.js";
import { normalizeTimestamp } from "./modelUtils.js";

export class TemplateItemModel {
    constructor({
        id = null,
        type = "",
        layout = {},
        placeholder = false,
    } = {}) {
        this.id = id;
        this.type = type;
        this.layout = LayoutModel.fromFirestore(layout);
        this.placeholder = placeholder;
    }

    static fromSnapshot(snapshot) {
        return new TemplateItemModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            type: this.type,
            layout: this.layout.toFirestore(),
            placeholder: this.placeholder,
        };
    }
}

export class TemplateModel {
    constructor({
        id = null,
        name = "",
        previewImage = "",
        category = "",
        createdAt = null,
    } = {}) {
        this.id = id;
        this.name = name;
        this.previewImage = previewImage;
        this.category = category;
        this.createdAt = normalizeTimestamp(createdAt);
    }

    static fromSnapshot(snapshot) {
        return new TemplateModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            name: this.name,
            previewImage: this.previewImage,
            category: this.category,
            createdAt: this.createdAt,
        };
    }
}
