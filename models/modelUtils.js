export function normalizeTimestamp(value) {
    if (!value) {
        return null;
    }

    // Preserve Firestore field transform sentinels such as serverTimestamp().
    if (
        typeof value === "object" &&
        value?.constructor?.name?.endsWith("Transform")
    ) {
        return value;
    }

    if (typeof value?.toDate === "function") {
        return value.toDate();
    }

    if (value instanceof Date) {
        return value;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
