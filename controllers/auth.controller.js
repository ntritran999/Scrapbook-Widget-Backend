import {
    loginAndCreateCustomToken,
    registerWithEmailAndPassword,
} from "../services/auth.service.js";

export async function postRegister(req, res, next) {
    try {
        const result = await registerWithEmailAndPassword(req.body);
        return res.status(201).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}

export async function postLogin(req, res, next) {
    try {
        const result = await loginAndCreateCustomToken(req.body);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}