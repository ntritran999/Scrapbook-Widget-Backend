import { listBackgroundImages } from "../services/background-image.service.js";

export async function getBackgrounds(req, res, next) {
    try {
        const backgrounds = await listBackgroundImages();
        res.json(backgrounds);
    } catch (error) {
        next(error);
    }
}