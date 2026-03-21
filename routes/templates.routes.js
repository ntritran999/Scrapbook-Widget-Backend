import { Router } from "express";

import {
    getTemplateItems,
    getTemplates,
    postTemplate,
    postTemplateItem,
} from "../controllers/template.controller.js";

const router = Router();

router.get("/", getTemplates);
router.post("/", postTemplate);

router.get("/:templateId/items", getTemplateItems);
router.post("/:templateId/items", postTemplateItem);

export default router;
