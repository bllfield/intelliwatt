"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = __importDefault(require("express"));
var multer_1 = __importDefault(require("multer"));
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var crypto_1 = __importDefault(require("crypto"));
var UPLOAD_DIR = process.env.SMT_UPLOAD_DIR || "/home/deploy/smt_inbox";
var PORT = Number(process.env.SMT_UPLOAD_PORT || "8081");
// Allow up to ~25MB by default so a full 12-month interval CSV (≈35k rows) clears the limit.
var MAX_BYTES = Number(process.env.SMT_UPLOAD_MAX_BYTES || 25 * 1024 * 1024);
var UPLOAD_TOKEN = process.env.SMT_UPLOAD_TOKEN || "";
// Admin limit: 40,000 allows ~365 days of 15-min interval files (96 intervals/day × 365 days = 35,040)
var ADMIN_LIMIT = Number(process.env.SMT_ADMIN_UPLOAD_DAILY_LIMIT || "40000");
var ADMIN_WINDOW_MS = Number(process.env.SMT_ADMIN_UPLOAD_WINDOW_MS || 24 * 60 * 60 * 1000);
var CUSTOMER_LIMIT = Number(process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT || "5");
var CUSTOMER_WINDOW_MS = Number(process.env.SMT_CUSTOMER_UPLOAD_WINDOW_MS || 30 * 24 * 60 * 60 * 1000);
// No cap here; allow operator to pass huge limits to normalize everything in one run.
var NORMALIZE_LIMIT = Math.max(Number(process.env.SMT_NORMALIZE_LIMIT || "100000"), 1);
// Main app webhook for registering and normalizing uploaded files
var INTELLIWATT_BASE_URL = process.env.INTELLIWATT_BASE_URL || "https://intelliwatt.com";
var ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
var counters = new Map();
function computeKey(role, accountKey) {
    return "".concat(role, ":").concat(accountKey || "unknown");
}
function getWindowConfig(role) {
    if (role === "admin") {
        return { limit: ADMIN_LIMIT, windowMs: ADMIN_WINDOW_MS };
    }
    return { limit: CUSTOMER_LIMIT, windowMs: CUSTOMER_WINDOW_MS };
}
function checkRateLimit(role, accountKey) {
    var _a = getWindowConfig(role), limit = _a.limit, windowMs = _a.windowMs;
    var key = computeKey(role, accountKey);
    var now = Date.now();
    var existing = counters.get(key);
    if (!existing || now - existing.windowStart > windowMs) {
        counters.set(key, {
            count: 1,
            windowStart: now,
            limit: limit,
            windowMs: windowMs,
        });
        return {
            ok: true,
            limit: limit,
            remaining: Math.max(limit - 1, 0),
            resetAt: now + windowMs,
        };
    }
    if (existing.count >= limit) {
        return {
            ok: false,
            limit: limit,
            remaining: 0,
            resetAt: existing.windowStart + windowMs,
        };
    }
    existing.count += 1;
    counters.set(key, existing);
    return {
        ok: true,
        limit: limit,
        remaining: Math.max(limit - existing.count, 0),
        resetAt: existing.windowStart + windowMs,
    };
}
if (!fs_1.default.existsSync(UPLOAD_DIR)) {
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
var storage = multer_1.default.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (_req, file, cb) {
        var ts = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
        var safeOriginal = (file.originalname || "upload.csv").replace(/[\s\\/:*?"<>|]+/g, "_");
        cb(null, "".concat(ts, "_").concat(safeOriginal));
    },
});
var upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: MAX_BYTES,
    },
});
var app = (0, express_1.default)();
app.use(function (req, res, next) {
    var origin = req.headers.origin;
    if (origin === "https://intelliwatt.com") {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, x-smt-upload-role, x-smt-upload-account-key, x-smt-upload-token");
    var len = req.headers["content-length"];
    // eslint-disable-next-line no-console
    console.log("[smt-upload] ".concat(req.method, " ").concat(req.url, " origin=").concat(origin || "n/a", " content-length=").concat(len || "n/a"));
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
    var headerToken = req.headers["x-smt-upload-token"];
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
function computeFileSha256(filepath) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var hash = crypto_1.default.createHash('sha256');
                    var stream = fs_1.default.createReadStream(filepath);
                    stream.on('data', function (data) { return hash.update(data); });
                    stream.on('end', function () { return resolve(hash.digest('hex')); });
                    stream.on('error', reject);
                })];
        });
    });
}
function recordPipelineError(status, step, details) {
    return __awaiter(this, void 0, void 0, function () {
        var trimmedDetails, payload, content, buffer, sha256, contentBase64, body, rawUploadUrl, resp, text, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ADMIN_TOKEN || !INTELLIWATT_BASE_URL) {
                        console.warn('[smt-upload] Cannot record pipeline error: ADMIN_TOKEN or INTELLIWATT_BASE_URL missing');
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    trimmedDetails = (details || '').slice(0, 4000);
                    payload = {
                        ok: false,
                        step: step,
                        status: status,
                        details: trimmedDetails,
                        recordedAt: new Date().toISOString(),
                    };
                    content = JSON.stringify(payload, null, 2);
                    buffer = Buffer.from(content, 'utf8');
                    sha256 = crypto_1.default.createHash('sha256').update(buffer).digest('hex');
                    contentBase64 = buffer.toString('base64');
                    body = {
                        filename: "smt-upload-error-".concat(step, "-").concat(status, ".json"),
                        sizeBytes: buffer.length,
                        sha256: sha256,
                        contentBase64: contentBase64,
                        source: 'droplet-error',
                        receivedAt: new Date().toISOString(),
                    };
                    rawUploadUrl = "".concat(INTELLIWATT_BASE_URL, "/api/admin/smt/raw-upload");
                    console.warn("[smt-upload] recording pipeline error at ".concat(rawUploadUrl, " status=").concat(status, " step=").concat(step));
                    return [4 /*yield*/, fetch(rawUploadUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-admin-token': ADMIN_TOKEN,
                            },
                            body: JSON.stringify(body),
                            signal: AbortSignal.timeout(15000),
                        })];
                case 2:
                    resp = _a.sent();
                    if (!!resp.ok) return [3 /*break*/, 4];
                    return [4 /*yield*/, resp.text()];
                case 3:
                    text = _a.sent();
                    console.warn("[smt-upload] failed to record pipeline error: ".concat(resp.status, " ").concat(text));
                    _a.label = 4;
                case 4: return [3 /*break*/, 6];
                case 5:
                    err_1 = _a.sent();
                    console.warn('[smt-upload] exception while recording pipeline error:', err_1);
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
async function registerAndNormalizeFile(filepath, filename, size_bytes) {
                    if (!ADMIN_TOKEN || !INTELLIWATT_BASE_URL) {
                        console.warn("[smt-upload] Cannot register file: ADMIN_TOKEN or INTELLIWATT_BASE_URL not configured");
        return {
                                ok: false,
                                message: "ADMIN_TOKEN or INTELLIWATT_BASE_URL not configured",
        };
                    }
    let deleted = false;
    try {
        // STEP 3: Large-file SMT ingestion - read file, optionally split into chunks,
        // send content to the app, normalize inline via /api/admin/smt/raw-upload,
        // then delete the local file.
        const fileContent = await fs_1.default.promises.readFile(filepath);
                    // eslint-disable-next-line no-console
        console.log(`[smt-upload] read file content: ${fileContent.length} bytes from ${filepath}`);
        const text = fileContent.toString("utf8");
        const lines = text.split(/\r?\n/);
        const header = lines[0] || "";
        const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);
        const LINES_PER_CHUNK = Number(process.env.SMT_RAW_LINES_PER_CHUNK || "500");
        const totalParts = dataLines.length > 0 ? Math.ceil(dataLines.length / LINES_PER_CHUNK) : 1;
        const rawUploadUrl = `${INTELLIWATT_BASE_URL}/api/admin/smt/raw-upload`;
        let totalFilesProcessed = 0;
        let totalIntervalsInserted = 0;
        for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
            const start = partIndex * LINES_PER_CHUNK;
            const end = Math.min(start + LINES_PER_CHUNK, dataLines.length);
            const partDataLines = dataLines.length > 0 ? dataLines.slice(start, end) : dataLines;
            if (partDataLines.length === 0 && dataLines.length > 0) {
                continue;
            }
            const partContent = dataLines.length > 0 ? [header, ...partDataLines].join("\n") : text;
            const partBuffer = Buffer.from(partContent, "utf8");
            const partSha256 = crypto_1.default.createHash("sha256").update(partBuffer).digest("hex");
            const contentBase64 = partBuffer.toString("base64");
            const partFilename = totalParts > 1 ? `${filename}.part${partIndex + 1}-of-${totalParts}` : filename;
            const rawUploadPayload = {
                filename: partFilename,
                sizeBytes: partBuffer.length,
                sha256: partSha256,
                contentBase64,
                        source: "droplet-upload",
                        receivedAt: new Date().toISOString(),
                purgeExisting: partIndex === 0,
                    };
                    // eslint-disable-next-line no-console
            console.log(`[smt-upload] registering raw file part ${partIndex + 1}/${totalParts} at ${rawUploadUrl} (bytes=${partBuffer.length})`);
            const rawResponse = await fetch(rawUploadUrl, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-admin-token": ADMIN_TOKEN,
                            },
                            body: JSON.stringify(rawUploadPayload),
                signal: AbortSignal.timeout(30000),
            });
            if (!rawResponse.ok) {
                const errBody = await rawResponse.text();
                console.error(`[smt-upload] raw-upload failed for part ${partIndex + 1}/${totalParts}: ${rawResponse.status} ${errBody}`);
                await recordPipelineError(rawResponse.status, "raw-upload", errBody);
                return {
                            ok: false,
                    message: `raw-upload failed: ${rawResponse.status}`,
                };
            }
            const rawResult = await rawResponse.json();
                    // eslint-disable-next-line no-console
            console.log(`[smt-upload] raw file part registered: ${JSON.stringify(rawResult)}`);
            const isDuplicate = (rawResult === null || rawResult === void 0 ? void 0 : rawResult.duplicate) === true || (rawResult === null || rawResult === void 0 ? void 0 : rawResult.status) === "duplicate";
                    if (isDuplicate) {
                continue;
            }
            if (rawResult === null || rawResult === void 0 ? void 0 : rawResult.normalizedInline) {
                totalFilesProcessed += 1;
                if (typeof rawResult.normalizedInline.intervalsInserted === "number") {
                    totalIntervalsInserted += rawResult.normalizedInline.intervalsInserted;
                }
            }
        }
        return {
                            ok: true,
            message: "normalize complete (inline via raw-upload)",
            filesProcessed: totalFilesProcessed,
            intervalsInserted: totalIntervalsInserted,
                            normalized: true,
        };
    }
    catch (err) {
        console.error("[smt-upload] error during registration/normalization:", err);
        await recordPipelineError(0, 'pipeline-error', String((err === null || err === void 0 ? void 0 : err.message) || err));
        return {
                            ok: false,
            message: `normalize error: ${(err === null || err === void 0 ? void 0 : err.message) || err}`,
        };
    }
    finally {
        try {
            await fs_1.default.promises.unlink(filepath);
                    deleted = true;
                    // eslint-disable-next-line no-console
            console.log(`[smt-upload] deleted local file (cleanup): ${filepath}`);
        }
        catch (unlinkErr) {
                    if (!deleted) {
                        // eslint-disable-next-line no-console
                console.warn(`[smt-upload] warning: failed to delete local file ${filepath}:`, unlinkErr);
                    }
            }
    }
}
function isIntervalFile(name) {
    return /interval/i.test(name);
}
app.use(function (req, res, next) {
    next();
});
app.get("/health", function (_req, res) {
    res.json({
        ok: true,
        service: "smt-upload-server",
        uploadDir: UPLOAD_DIR,
        maxBytes: MAX_BYTES,
    });
});
app.post("/upload", verifyUploadToken, upload.single("file"), function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var roleHeader, accountHeader, roleRaw, role, accountKeyRaw, accountKey, rate, resetAtIso, file, destPath, writeErr_1, sizeGuess, originalName, intervalFile, unlinkErr_2, result, err_3;
    var _a, _b, _c, _d, _e;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                roleHeader = req.headers["x-smt-upload-role"];
                accountHeader = req.headers["x-smt-upload-account-key"];
                roleRaw = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.role) ||
                    (typeof roleHeader === "string" ? roleHeader : Array.isArray(roleHeader) ? roleHeader[0] : undefined) ||
                    "admin";
                role = roleRaw.toString().toLowerCase() === "customer" ? "customer" : "admin";
                accountKeyRaw = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.accountKey) ||
                    (typeof accountHeader === "string"
                        ? accountHeader
                        : Array.isArray(accountHeader)
                            ? accountHeader[0]
                            : undefined) ||
                    req.ip ||
                    "unknown";
                accountKey = accountKeyRaw.toString();
                // eslint-disable-next-line no-console
                console.log("[smt-upload] /upload start role=".concat(role, " accountKey=").concat(accountKey, " hasFile=").concat(req.file ? "true" : "false"));
                rate = checkRateLimit(role, accountKey);
                resetAtIso = new Date(rate.resetAt).toISOString();
                if (!rate.ok) {
                    res.status(429).json({
                        ok: false,
                        error: "rate_limited",
                        role: role,
                        accountKey: accountKey,
                        limit: rate.limit,
                        remaining: 0,
                        resetAt: resetAtIso,
                        message: role === "admin"
                            ? "Admin upload limit reached for the current 24-hour window"
                            : "Customer upload limit reached for the current 30-day window",
                    });
                    return [2 /*return*/];
                }
                _f.label = 1;
            case 1:
                _f.trys.push([1, 15, , 16]);
                file = req.file;
                if (!file) {
                    console.warn("[smt-upload] No file in request (field \"file\" missing)");
                    res.status(400).json({
                        ok: false,
                        error: 'Missing file field "file"',
                    });
                    return [2 /*return*/];
                }
                destPath = path_1.default.join(UPLOAD_DIR, file.filename || file.originalname || "upload.csv");
                _f.label = 2;
            case 2:
                _f.trys.push([2, 7, , 8]);
                if (!(file.path && file.path !== destPath)) return [3 /*break*/, 4];
                return [4 /*yield*/, fs_1.default.promises.rename(file.path, destPath)];
            case 3:
                _f.sent();
                return [3 /*break*/, 6];
            case 4:
                if (!(!file.path && file.buffer)) return [3 /*break*/, 6];
                return [4 /*yield*/, fs_1.default.promises.writeFile(destPath, file.buffer)];
            case 5:
                _f.sent();
                _f.label = 6;
            case 6: return [3 /*break*/, 8];
            case 7:
                writeErr_1 = _f.sent();
                // eslint-disable-next-line no-console
                console.error("[smt-upload] Failed to persist file:", writeErr_1);
                throw writeErr_1;
            case 8:
                sizeGuess = (typeof file.size === "number" ? file.size : undefined) ||
                    (typeof req.headers["content-length"] === "string"
                        ? Number(req.headers["content-length"])
                        : undefined) ||
                    0;
                originalName = file.originalname || file.filename || "upload.csv";
                intervalFile = isIntervalFile(originalName);
                // eslint-disable-next-line no-console
                console.log("[smt-upload] saved file=".concat(destPath, " bytes=").concat(sizeGuess !== null && sizeGuess !== void 0 ? sizeGuess : "n/a", " role=").concat(role, " accountKey=").concat(accountKey, " interval=").concat(intervalFile));
                if (!!intervalFile) return [3 /*break*/, 13];
                _f.label = 9;
            case 9:
                _f.trys.push([9, 11, , 12]);
                return [4 /*yield*/, fs_1.default.promises.unlink(destPath)];
            case 10:
                _f.sent();
                // eslint-disable-next-line no-console
                console.log("[smt-upload] deleted non-interval file: ".concat(originalName));
                return [3 /*break*/, 12];
            case 11:
                unlinkErr_2 = _f.sent();
                // eslint-disable-next-line no-console
                console.warn("[smt-upload] warning: failed to delete non-interval file ".concat(destPath, ":"), unlinkErr_2);
                return [3 /*break*/, 12];
            case 12:
                res.status(202).json({
                    ok: true,
                    message: "Upload ignored (non-interval file removed)",
                    file: {
                        name: originalName,
                        size: sizeGuess !== null && sizeGuess !== void 0 ? sizeGuess : null,
                        path: destPath,
                        interval: intervalFile,
                    },
                    meta: {
                        role: role,
                        accountKey: accountKey,
                        limit: rate.limit,
                        remaining: rate.remaining,
                        resetAt: resetAtIso,
                    },
                });
                return [2 /*return*/];
            case 13: return [4 /*yield*/, registerAndNormalizeFile(destPath, originalName, sizeGuess)];
            case 14:
                result = _f.sent();
                res.status(result.ok ? 200 : 500).json({
                    ok: result.ok,
                    message: result.message,
                    file: {
                        name: originalName,
                        size: sizeGuess !== null && sizeGuess !== void 0 ? sizeGuess : null,
                        path: destPath,
                        interval: intervalFile,
                    },
                    meta: {
                        role: role,
                        accountKey: accountKey,
                        limit: rate.limit,
                        remaining: rate.remaining,
                        resetAt: resetAtIso,
                    },
                    ingest: {
                        filesProcessed: (_c = result.filesProcessed) !== null && _c !== void 0 ? _c : 0,
                        intervalsInserted: (_d = result.intervalsInserted) !== null && _d !== void 0 ? _d : 0,
                        normalized: (_e = result.normalized) !== null && _e !== void 0 ? _e : false,
                    },
                });
                return [3 /*break*/, 16];
            case 15:
                err_3 = _f.sent();
                // eslint-disable-next-line no-console
                console.error("[smt-upload] /upload error:", err_3);
                res.status(500).json({
                    ok: false,
                    error: "Upload failed",
                    detail: String((err_3 === null || err_3 === void 0 ? void 0 : err_3.message) || err_3),
                });
                return [3 /*break*/, 16];
            case 16: return [2 /*return*/];
        }
    });
}); });
app.use(function (err, req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
_next) {
    // eslint-disable-next-line no-console
    console.error("[smt-upload] Unhandled error:", err);
    if (res.headersSent) {
        return;
    }
    var origin = req.headers.origin;
    if (origin === "https://intelliwatt.com") {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
    }
    res.status(500).json({
        ok: false,
        error: "Internal error in upload server",
        detail: String((err === null || err === void 0 ? void 0 : err.message) || err),
    });
});
// Lightweight keep-alive timer so the process never exits unexpectedly.
setInterval(function () {
    // eslint-disable-next-line no-console
    console.log("[smt-upload] keep-alive tick");
}, 60 * 60 * 1000);
app.listen(PORT, function () {
    // eslint-disable-next-line no-console
    console.log("SMT upload server listening on port ".concat(PORT, ", dir=").concat(UPLOAD_DIR, ", maxBytes=").concat(MAX_BYTES));
});
