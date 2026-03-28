import multer from "multer";

// Configure multer for memory storage (stores file in buffer)
const storage = multer.memoryStorage();

// File filter to only accept image files
const fileFilter = (req, file, cb) => {
    // Allowed MIME types
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype) {
        return cb(null, true);
    } else {
        cb(new Error(`Only image files are allowed. Received: ${file.mimetype}`));
    }
};

// Create multer upload middleware
export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB limit
    },
});

/**
 * Middleware to handle single file upload with field name 'image'
 * Usage: router.post('/endpoint', uploadImage.single('image'), controller)
 */
export const uploadImage = upload.single("file");

/**
 * Middleware to handle file upload errors gracefully
 * Usage: router.post('/endpoint', uploadImage, handleUploadError, controller)
 */
export function handleUploadError(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        console.log(err);
        if (err.code === "FILE_TOO_LARGE") {
            return res
                .status(400)
                .json({ message: "File is too large (max 50MB)" });
        }
        return res.status(400).json({ message: `Upload error: ${err.message}` });
    } else if (err) {
        console.log(err);
        return res.status(400).json({ message: err.message });
    }
    next();
}
