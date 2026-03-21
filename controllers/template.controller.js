import {
    createTemplate,
    createTemplateItem,
    listTemplateItems,
    listTemplates,
} from "../services/template.service.js";

export async function getTemplates(req, res, next) {
    try {
        const templates = await listTemplates();
        res.json(templates);
    } catch (error) {
        next(error);
    }
}

export async function postTemplate(req, res, next) {
    try {
        const template = await createTemplate(req.body);
        res.status(201).json(template);
    } catch (error) {
        next(error);
    }
}

export async function getTemplateItems(req, res, next) {
    try {
        const items = await listTemplateItems(req.params.templateId);
        res.json(items);
    } catch (error) {
        next(error);
    }
}

export async function postTemplateItem(req, res, next) {
    try {
        const item = await createTemplateItem(req.params.templateId, req.body);
        res.status(201).json(item);
    } catch (error) {
        next(error);
    }
}
