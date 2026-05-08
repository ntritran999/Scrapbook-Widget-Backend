import fs from "node:fs";
import path from "node:path";
import util from "node:util";

const logsDir = path.resolve(process.cwd(), "logs");
const logFilePath = path.resolve(
    process.cwd(),
    process.env.CONSOLE_LOG_FILE || path.join("logs", "console.log")
);

fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
if (path.dirname(logFilePath) === logsDir) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logStream = fs.createWriteStream(logFilePath, { flags: "a" });
const patchedFlag = Symbol.for("scrapbook.consoleOutputPatched");

function serializeConsoleArgs(args) {
    return args
        .map((arg) =>
            typeof arg === "string"
                ? arg
                : util.inspect(arg, {
                    depth: 8,
                    colors: false,
                    breakLength: Infinity,
                    maxArrayLength: 100,
                })
        )
        .join(" ");
}

function patchConsoleMethod(methodName) {
    const originalMethod = console[methodName]?.bind(console);
    if (!originalMethod || originalMethod[patchedFlag]) {
        return;
    }

    const wrappedMethod = (...args) => {
        const timestamp = new Date().toISOString();
        const message = serializeConsoleArgs(args);

        try {
            logStream.write(`[${timestamp}] [${methodName.toUpperCase()}] ${message}\n`);
        } catch {
            // Preserve application flow even if file logging fails.
        }

        originalMethod(...args);
    };

    wrappedMethod[patchedFlag] = true;
    console[methodName] = wrappedMethod;
}

["log", "info", "warn", "error", "debug"].forEach(patchConsoleMethod);

process.on("beforeExit", () => {
    logStream.end();
});

