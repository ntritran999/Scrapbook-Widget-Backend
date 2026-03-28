import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary with environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload file/content to Cloudinary
 * @param {string|Buffer|Stream} content - File content, base64 string, or buffer to upload
 * @param {string} itemType - Type of item (e.g., 'photo', 'sticker')
 * @param {string} userId - User ID for folder organization in Cloudinary
 * @param {string} groupId - Group ID for folder organization in Cloudinary
 * @returns {Promise<{secure_url: string, public_id: string}>} Uploaded file URL and public ID
 * @throws {Error} If Cloudinary upload fails or env variables are missing
 */
export async function uploadToCloudinary(content, itemType, userId, groupId) {
    try {
        // Validate required environment variables
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
            throw new Error("Cloudinary environment variables are not configured");
        }

        // Validate content
        if (!content) {
            throw new Error("Content is required for upload");
        }

        // Organize uploads in folders: scrapbooks/{groupId}/{userId}/items
        const publicIdPath = `scrapbooks/${groupId}/${userId}/${itemType}/${Date.now()}`;

        // Upload to Cloudinary using promise wrapper for buffer/stream
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    public_id: publicIdPath,
                    folder: `scrapbooks/${groupId}/${userId}`,
                    resource_type: "auto", // Automatically detect file type
                    quality: "auto", // Optimize quality
                },
                (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                }
            );

            // If content is a Buffer, use it directly; if string (base64), handle accordingly
            if (Buffer.isBuffer(content)) {
                uploadStream.end(content);
            } else if (typeof content === "string") {
                uploadStream.end(Buffer.from(content, "base64"));
            } else {
                uploadStream.end(content);
            }
        });

        return {
            secure_url: result.secure_url,
            public_id: result.public_id,
            url: result.url,
        };
    } catch (error) {
        console.error("Error uploading to Cloudinary:", error);
        throw new Error(`Failed to upload content to Cloudinary: ${error.message}`);
    }
}

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Public ID of the file to delete from Cloudinary
 * @returns {Promise<{result: string}>} Deletion result
 * @throws {Error} If deletion fails
 */
export async function deleteFromCloudinary(publicId) {
    try {
        if (!publicId) {
            throw new Error("Public ID is required for deletion");
        }

        const result = await cloudinary.uploader.destroy(publicId);
        return result;
    } catch (error) {
        console.error("Error deleting from Cloudinary:", error);
        throw new Error(`Failed to delete content from Cloudinary: ${error.message}`);
    }
}
