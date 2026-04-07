import nodemailer from "nodemailer";

function parseSmtpPort(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 587;
    }
    return parsed;
}

function parseSmtpSecure(value, port) {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    return port === 465;
}

function getSmtpConfig() {
    const host = String(process.env.SMTP_HOST || "").trim();
    const user = String(process.env.SMTP_USER || "").trim();
    const pass = String(process.env.SMTP_PASS || "").trim();
    const from = String(process.env.SMTP_FROM || "").trim();
    const port = parseSmtpPort(process.env.SMTP_PORT);
    const secure = parseSmtpSecure(process.env.SMTP_SECURE, port);

    const hasCredentials = Boolean(host && user && pass && from);

    return {
        host,
        port,
        secure,
        user,
        pass,
        from,
        hasCredentials,
    };
}

let cachedTransporter = null;
let cachedTransportKey = "";

function getTransporter(config) {
    const nextKey = `${config.host}:${config.port}:${config.secure}:${config.user}`;

    if (cachedTransporter && cachedTransportKey === nextKey) {
        return cachedTransporter;
    }

    cachedTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
    cachedTransportKey = nextKey;

    return cachedTransporter;
}

async function sendMailIfConfigured({ toEmail, subject, text, html }) {
    const targetEmail = String(toEmail || "").trim();
    if (!targetEmail) {
        return {
            sent: false,
            skipped: true,
            reason: "missing-target-email",
        };
    }

    const config = getSmtpConfig();
    if (!config.hasCredentials) {
        return {
            sent: false,
            skipped: true,
            reason: "smtp-not-configured",
        };
    }

    const transporter = getTransporter(config);
    await transporter.sendMail({
        from: config.from,
        to: targetEmail,
        subject,
        text,
        html,
    });

    return {
        sent: true,
        skipped: false,
        reason: null,
    };
}

export async function sendRegisterOtpEmail({ toEmail, otpCode, expiresInMinutes = 10 }) {
    const safeOtpCode = String(otpCode || "").trim();
    if (!safeOtpCode) {
        return {
            sent: false,
            skipped: true,
            reason: "missing-otp-code",
        };
    }

    return sendMailIfConfigured({
        toEmail,
        subject: "Your Scrapbook Widget OTP Code",
        text: [
            "Your OTP code for registration is:",
            safeOtpCode,
            "",
            `This code expires in ${expiresInMinutes} minutes.`,
            "If you did not request this, please ignore this email.",
        ].join("\n"),
        html: [
            "<p>Your OTP code for registration is:</p>",
            `<p><strong style=\"font-size: 22px; letter-spacing: 4px;\">${safeOtpCode}</strong></p>`,
            `<p>This code expires in ${expiresInMinutes} minutes.</p>`,
            "<p>If you did not request this, please ignore this email.</p>",
        ].join(""),
    });
}

export async function sendNewGoogleAccountWelcomeEmail({
    toEmail,
    displayName,
    defaultGroupName,
}) {
    const safeName = String(displayName || "").trim() || "there";
    const safeGroupName = String(defaultGroupName || "").trim() || "My Scrapbook";

    return sendMailIfConfigured({
        toEmail,
        subject: "Welcome to Scrapbook Widget",
        text: [
            `Hi ${safeName},`,
            "",
            "Your Google account has been registered successfully.",
            `A starter scrapbook has been created for you: ${safeGroupName}.`,
            "",
            "You can now open the app and start sharing memories.",
            "",
            "Best regards,",
            "Scrapbook Widget Team",
        ].join("\n"),
        html: [
            `<p>Hi <strong>${safeName}</strong>,</p>`,
            "<p>Your Google account has been registered successfully.</p>",
            `<p>A starter scrapbook has been created for you: <strong>${safeGroupName}</strong>.</p>`,
            "<p>You can now open the app and start sharing memories.</p>",
            "<p>Best regards,<br/>Scrapbook Widget Team</p>",
        ].join(""),
    });
}
