export class LayoutModel {
    constructor({
        x = 0,
        y = 0,
        width = 0,
        height = 0,
        rotation = 0,
        scale = 1,
        zIndex = 0,
    } = {}) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.rotation = rotation;
        this.scale = scale;
        this.zIndex = zIndex;
    }

    static fromFirestore(data = {}) {
        return new LayoutModel(data);
    }

    toFirestore() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            rotation: this.rotation,
            scale: this.scale,
            zIndex: this.zIndex,
        };
    }
}
