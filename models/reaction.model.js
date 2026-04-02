export class ReactionModel {
    constructor({
        id = null,
        type = "",
    } = {}) {
        this.id = id;
        this.type = type;
    }

    static fromSnapshot(snapshot) {
        return new ReactionModel({ id: snapshot.id, ...snapshot.data() });
    }

    toFirestore() {
        return {
            type: this.type,
        };
    }
}