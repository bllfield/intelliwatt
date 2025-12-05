"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const UPLOAD_DIR = process.env.SMT_UPLOAD_DIR || "/home/deploy/smt_inbox";
const PORT = Number(process.env.SMT_UPLOAD_PORT || "8081");
const MAX_BYTES = Number(process.env.SMT_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const UPLOAD_TOKEN = process.env.SMT_UPLOAD_TOKEN || "";
// Admin limit: 40,000 allows ~365 days of 15-min interval files (96 intervals/day × 365 days = 35,040)
const ADMIN_LIMIT = Number(process.env.SMT_ADMIN_UPLOAD_DAILY_LIMIT || "40000");
const ADMIN_WINDOW_MS = Number(process.env.SMT_ADMIN_UPLOAD_WINDOW_MS || 24 * 60 * 60 * 1000);
const CUSTOMER_LIMIT = Number(process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT || "5");
const CUSTOMER_WINDOW_MS = Number(process.env.SMT_CUSTOMER_UPLOAD_WINDOW_MS || 30 * 24 * 60 * 60 * 1000);
// Main app webhook for registering and normalizing uploaded files
const INTELLIWATT_BASE_URL = process.env.INTELLIWATT_BASE_URL || "https://intelliwatt.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const counters = new Map();
function computeKey(role, accountKey) {
    return `${role}:${accountKey || "unknown"}`;
}
function getWindowConfig(role) {
    if (role === "admin") {
        return { limit: ADMIN_LIMIT, windowMs: ADMIN_WINDOW_MS };
    }
    return { limit: CUSTOMER_LIMIT, windowMs: CUSTOMER_WINDOW_MS };
}
function checkRateLimit(role, accountKey) {
    const { limit, windowMs } = getWindowConfig(role);
    const key = computeKey(role, accountKey);
    const now = Date.now();
    const existing = counters.get(key);
    if (!existing || now - existing.windowStart > windowMs) {
        counters.set(key, {
            count: 1,
            windowStart: now,
            limit,
            windowMs,
        });
        return {
            ok: true,
            limit,
            remaining: Math.max(limit - 1, 0),
            resetAt: now + windowMs,
        };
    }
    if (existing.count >= limit) {
        return {
            ok: false,
            limit,
            remaining: 0,
            resetAt: existing.windowStart + windowMs,
        };
    }
    existing.count += 1;
    counters.set(key, existing);
    return {
        ok: true,
        limit,
        remaining: Math.max(limit - existing.count, 0),
        resetAt: existing.windowStart + windowMs,
    };
}
if (!fs_1.default.existsSync(UPLOAD_DIR)) {
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        const ts = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
        const safeOriginal = (file.originalname || "upload.csv").replace(/[\s\\/:*?"<>|]+/g, "_");
        cb(null, `${ts}_${safeOriginal}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: MAX_BYTES,
    },
});
const app = (0, express_1.default)();
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === "https://intelliwatt.com") {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, x-smt-upload-role, x-smt-upload-account-key, x-smt-upload-token");
    const len = req.headers["content-length"];
    // eslint-disable-next-line no-console
    console.log(`[smt-upload] ${req.method} ${req.url} origin=${origin || "n/a"} content-length=${len || "n/a"}`);
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});
function verifyUploadToken(req, res, next) {
    if (!UPLOAD_TOKEN) {
        next();
        return;
    }
    const headerToken = req.headers["x-smt-upload-token"];
    if ((typeof headerToken === "string" && headerToken === UPLOAD_TOKEN) ||
        (Array.isArray(headerToken) && headerToken.includes(UPLOAD_TOKEN))) {
        next();
        return;
    }
    res.status(401).json({
        ok: false,
        error: "unauthorized",
        message: "Invalid or missing SMT upload token",
    });
}
async function computeFileSha256(filepath) {
    return new Promise((resolve, reject) => {
        const hash = crypto_1.default.createHash('sha256');
        const stream = fs_1.default.createReadStream(filepath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
async function registerAndNormalizeFile(filepath, filename, size_bytes) {
    if (!ADMIN_TOKEN || !INTELLIWATT_BASE_URL) {
        console.warn("[smt-upload] Cannot register file: ADMIN_TOKEN or INTELLIWATT_BASE_URL not configured");
        return;
    }
    try {
        const sha256 = await computeFileSha256(filepath);
        // eslint-disable-next-line no-console
        console.log(`[smt-upload] computed sha256=${sha256} for file=${filepath}`);
        // Step 1: Register the raw file with the main app
        const rawUploadUrl = `${INTELLIWATT_BASE_URL}/api/admin/smt/raw-upload`;
        const rawUploadPayload = {
            filename,
            size_bytes,
            sha256,
            source: "droplet-upload",
            received_at: new Date().toISOString(),
        };
        // eslint-disable-next-line no-console
        console.log(`[smt-upload] registering raw file at ${rawUploadUrl}`);
        const rawResponse = await fetch(rawUploadUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-token": ADMIN_TOKEN,
            },
            body: JSON.stringify(rawUploadPayload),
        });
        if (!rawResponse.ok) {
            const errBody = await rawResponse.text();
            console.error(`[smt-upload] raw-upload failed: ${rawResponse.status} ${errBody}`);
            return;
        }
        const rawResult = await rawResponse.json();
        // eslint-disable-next-line no-console
        console.log(`[smt-upload] raw file registered: ${JSON.stringify(rawResult)}`);
        // Step 2: Trigger normalization of the raw file
        const normalizeUrl = `${INTELLIWATT_BASE_URL}/api/admin/smt/normalize?limit=1`;
        // eslint-disable-next-line no-console
        console.log(`[smt-upload] triggering normalization at ${normalizeUrl}`);
        const normResponse = await fetch(normalizeUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-token": ADMIN_TOKEN,
            },
            body: JSON.stringify({}),
        });
        if (!normResponse.ok) {
            const errBody = await normResponse.text();
            console.error(`[smt-upload] normalize failed: ${normResponse.status} ${errBody}`);
            return;
        }
        const normResult = await normResponse.json();
        // eslint-disable-next-line no-console
        console.log(`[smt-upload] normalization complete: filesProcessed=${normResult.filesProcessed} intervalsInserted=${normResult.intervalsInserted}`);
    }
    catch (err) {
        console.error("[smt-upload] error during registration/normalization:", err);
    }
}
app.use((req, res, next) => {
    next();
});
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "smt-upload-server",
        uploadDir: UPLOAD_DIR,
        maxBytes: MAX_BYTES,
    });
});
app.post("/upload", verifyUploadToken, upload.single("file"), async (req, res) => {
    const roleHeader = req.headers["x-smt-upload-role"];
    const accountHeader = req.headers["x-smt-upload-account-key"];
    const roleRaw = req.body?.role ||
        (typeof roleHeader === "string" ? roleHeader : Array.isArray(roleHeader) ? roleHeader[0] : undefined) ||
        "admin";
    const role = roleRaw.toString().toLowerCase() === "customer" ? "customer" : "admin";
    const accountKeyRaw = req.body?.accountKey ||
        (typeof accountHeader === "string"
            ? accountHeader
            : Array.isArray(accountHeader)
                ? accountHeader[0]
                : undefined) ||
        req.ip ||
        "unknown";
    const accountKey = accountKeyRaw.toString();
    // eslint-disable-next-line no-console
    console.log(`[smt-upload] /upload start role=${role} accountKey=${accountKey} hasFile=${req.file ? "true" : "false"}`);
    const rate = checkRateLimit(role, accountKey);
    const resetAtIso = new Date(rate.resetAt).toISOString();
    if (!rate.ok) {
        res.status(429).json({
            ok: false,
            error: "rate_limited",
            role,
            accountKey,
            limit: rate.limit,
            remaining: 0,
            resetAt: resetAtIso,
            message: role === "admin"
                ? "Admin upload limit reached for the current 24-hour window"
                : "Customer upload limit reached for the current 30-day window",
        });
        return;
    }
    try {
        const file = req.file;
        if (!file) {
            console.warn("[smt-upload] No file in request (field \"file\" missing)");
            res.status(400).json({
                ok: false,
                error: 'Missing file field "file"',
            });
            return;
        }
        const destPath = path_1.default.join(UPLOAD_DIR, file.filename || file.originalname || "upload.csv");
        try {
            if (file.path && file.path !== destPath) {
                await fs_1.default.promises.rename(file.path, destPath);
            }
            else if (!file.path && file.buffer) {
                await fs_1.default.promises.writeFile(destPath, file.buffer);
            }
        }
        catch (writeErr) {
            // eslint-disable-next-line no-console
            console.error("[smt-upload] Failed to persist file:", writeErr);
            throw writeErr;
        }
        const sizeGuess = (typeof file.size === "number" ? file.size : undefined) ||
            (typeof req.headers["content-length"] === "string"
                ? Number(req.headers["content-length"])
                : undefined) ||
            0;
        // eslint-disable-next-line no-console
        console.log(`[smt-upload] saved file=${destPath} bytes=${sizeGuess ?? "n/a"} role=${role} accountKey=${accountKey}`);
        // NEW: Register and normalize the file with the main app in the background
        // Don't wait for this to complete before responding (fire-and-forget)
        registerAndNormalizeFile(destPath, file.originalname || file.filename || "upload.csv", sizeGuess)
            .catch(err => {
            console.error("[smt-upload] background registration/normalization failed:", err);
        });
        res.status(202).json({
            ok: true,
            message: "Upload accepted and ingest triggered",
            file: {
                name: file.originalname || file.filename,
                size: sizeGuess ?? null,
                path: destPath,
            },
            meta: {
                role,
                accountKey,
                limit: rate.limit,
                remaining: rate.remaining,
                resetAt: resetAtIso,
            },
        });
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error("[smt-upload] /upload error:", err);
        res.status(500).json({
            ok: false,
            error: "Upload failed",
            detail: String(err?.message || err),
        });
    }
});
app.use((err, req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
_next) => {
    // eslint-disable-next-line no-console
    console.error("[smt-upload] Unhandled error:", err);
    if (res.headersSent) {
        return;
    }
    const origin = req.headers.origin;
    if (origin === "https://intelliwatt.com") {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
    }
    res.status(500).json({
        ok: false,
        error: "Internal error in upload server",
        detail: String(err?.message || err),
    });
});
// Lightweight keep-alive timer so the process never exits unexpectedly.
setInterval(() => {
    // eslint-disable-next-line no-console
    console.log("[smt-upload] keep-alive tick");
}, 60 * 60 * 1000);
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SMT upload server listening on port ${PORT}, dir=${UPLOAD_DIR}, maxBytes=${MAX_BYTES}`);
});
