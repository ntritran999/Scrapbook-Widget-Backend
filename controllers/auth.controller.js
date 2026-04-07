import {
    deleteAccountByUid,
    loginWithGoogleIdToken,
    loginWithEmailAndPassword,
    requestRegisterOtp,
    registerWithEmailAndPassword,
    signOutByUid,
    verifyIdTokenAndCreateSession,
} from "../services/auth.service.js";

export async function postRegisterOtp(req, res, next) {
    try {
        const result = await requestRegisterOtp(req.body);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}

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
        const result = await loginWithEmailAndPassword(req.body);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}

export async function postSession(req, res, next) {
    try {
        const result = await verifyIdTokenAndCreateSession(req.body);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}

export async function postSignout(req, res, next) {
    try {
        const result = await signOutByUid(req.authUser?.uid);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}

export async function deleteAccount(req, res, next) {
    try {
        const result = await deleteAccountByUid(req.authUser?.uid);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}

export async function postGoogleLogin(req, res, next) {
    try {
        const result = await loginWithGoogleIdToken(req.body);
        return res.status(200).json(result);
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
}