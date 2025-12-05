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
var MAX_BYTES = Number(process.env.SMT_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
var UPLOAD_TOKEN = process.env.SMT_UPLOAD_TOKEN || "";
// Admin limit: 40,000 allows ~365 days of 15-min interval files (96 intervals/day × 365 days = 35,040)
var ADMIN_LIMIT = Number(process.env.SMT_ADMIN_UPLOAD_DAILY_LIMIT || "40000");
var ADMIN_WINDOW_MS = Number(process.env.SMT_ADMIN_UPLOAD_WINDOW_MS || 24 * 60 * 60 * 1000);
var CUSTOMER_LIMIT = Number(process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT || "5");
var CUSTOMER_WINDOW_MS = Number(process.env.SMT_CUSTOMER_UPLOAD_WINDOW_MS || 30 * 24 * 60 * 60 * 1000);
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
function registerAndNormalizeFile(filepath, filename, size_bytes) {
    return __awaiter(this, void 0, void 0, function () {
        var sha256, fileContent, contentBase64, rawUploadUrl, rawUploadPayload, rawResponse, errBody, rawResult, normalizeUrl, normResponse, errBody, normResult, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ADMIN_TOKEN || !INTELLIWATT_BASE_URL) {
                        console.warn("[smt-upload] Cannot register file: ADMIN_TOKEN or INTELLIWATT_BASE_URL not configured");
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 12, , 13]);
                    return [4 /*yield*/, computeFileSha256(filepath)];
                case 2:
                    sha256 = _a.sent();
                    // eslint-disable-next-line no-console
                    console.log("[smt-upload] computed sha256=".concat(sha256, " for file=").concat(filepath));
                    return [4 /*yield*/, fs_1.default.promises.readFile(filepath)];
                case 3:
                    fileContent = _a.sent();
                    contentBase64 = fileContent.toString('base64');
                    // eslint-disable-next-line no-console
                    console.log("[smt-upload] read file content: ".concat(fileContent.length, " bytes, base64 length: ").concat(contentBase64.length));
                    rawUploadUrl = "".concat(INTELLIWATT_BASE_URL, "/api/admin/smt/raw-upload");
                    rawUploadPayload = {
                        filename: filename,
                        size_bytes: size_bytes,
                        sha256: sha256,
                        content: contentBase64,
                        source: "droplet-upload",
                        received_at: new Date().toISOString(),
                    };
                    // eslint-disable-next-line no-console
                    console.log("[smt-upload] registering raw file at ".concat(rawUploadUrl));
                    return [4 /*yield*/, fetch(rawUploadUrl, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-admin-token": ADMIN_TOKEN,
                            },
                            body: JSON.stringify(rawUploadPayload),
                            signal: AbortSignal.timeout(30000), // 30 second timeout for registration
                        })];
                case 4:
                    rawResponse = _a.sent();
                    if (!!rawResponse.ok) return [3 /*break*/, 6];
                    return [4 /*yield*/, rawResponse.text()];
                case 5:
                    errBody = _a.sent();
                    console.error("[smt-upload] raw-upload failed: ".concat(rawResponse.status, " ").concat(errBody));
                    return [2 /*return*/];
                case 6: return [4 /*yield*/, rawResponse.json()];
                case 7:
                    rawResult = _a.sent();
                    // eslint-disable-next-line no-console
                    console.log("[smt-upload] raw file registered: ".concat(JSON.stringify(rawResult)));
                    normalizeUrl = "".concat(INTELLIWATT_BASE_URL, "/api/admin/smt/normalize?limit=1");
                    // eslint-disable-next-line no-console
                    console.log("[smt-upload] triggering normalization at ".concat(normalizeUrl));
                    return [4 /*yield*/, fetch(normalizeUrl, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-admin-token": ADMIN_TOKEN,
                            },
                            body: JSON.stringify({}),
                            signal: AbortSignal.timeout(300000), // 5 minute timeout for normalization (large files)
                        })];
                case 8:
                    normResponse = _a.sent();
                    if (!!normResponse.ok) return [3 /*break*/, 10];
                    return [4 /*yield*/, normResponse.text()];
                case 9:
                    errBody = _a.sent();
                    console.error("[smt-upload] normalize failed: ".concat(normResponse.status, " ").concat(errBody));
                    return [2 /*return*/];
                case 10: return [4 /*yield*/, normResponse.json()];
                case 11:
                    normResult = _a.sent();
                    // eslint-disable-next-line no-console
                    console.log("[smt-upload] normalization complete: filesProcessed=".concat(normResult.filesProcessed, " intervalsInserted=").concat(normResult.intervalsInserted));
                    return [3 /*break*/, 13];
                case 12:
                    err_1 = _a.sent();
                    console.error("[smt-upload] error during registration/normalization:", err_1);
                    return [3 /*break*/, 13];
                case 13: return [2 /*return*/];
            }
        });
    });
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
    var roleHeader, accountHeader, roleRaw, role, accountKeyRaw, accountKey, rate, resetAtIso, file, destPath, writeErr_1, sizeGuess, err_2;
    var _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
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
                _c.label = 1;
            case 1:
                _c.trys.push([1, 9, , 10]);
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
                _c.label = 2;
            case 2:
                _c.trys.push([2, 7, , 8]);
                if (!(file.path && file.path !== destPath)) return [3 /*break*/, 4];
                return [4 /*yield*/, fs_1.default.promises.rename(file.path, destPath)];
            case 3:
                _c.sent();
                return [3 /*break*/, 6];
            case 4:
                if (!(!file.path && file.buffer)) return [3 /*break*/, 6];
                return [4 /*yield*/, fs_1.default.promises.writeFile(destPath, file.buffer)];
            case 5:
                _c.sent();
                _c.label = 6;
            case 6: return [3 /*break*/, 8];
            case 7:
                writeErr_1 = _c.sent();
                // eslint-disable-next-line no-console
                console.error("[smt-upload] Failed to persist file:", writeErr_1);
                throw writeErr_1;
            case 8:
                sizeGuess = (typeof file.size === "number" ? file.size : undefined) ||
                    (typeof req.headers["content-length"] === "string"
                        ? Number(req.headers["content-length"])
                        : undefined) ||
                    0;
                // eslint-disable-next-line no-console
                console.log("[smt-upload] saved file=".concat(destPath, " bytes=").concat(sizeGuess !== null && sizeGuess !== void 0 ? sizeGuess : "n/a", " role=").concat(role, " accountKey=").concat(accountKey));
                // NEW: Register and normalize the file with the main app in the background
                // Don't wait for this to complete before responding (fire-and-forget)
                registerAndNormalizeFile(destPath, file.originalname || file.filename || "upload.csv", sizeGuess)
                    .catch(function (err) {
                    console.error("[smt-upload] background registration/normalization failed:", err);
                });
                res.status(202).json({
                    ok: true,
                    message: "Upload accepted and ingest triggered",
                    file: {
                        name: file.originalname || file.filename,
                        size: sizeGuess !== null && sizeGuess !== void 0 ? sizeGuess : null,
                        path: destPath,
                    },
                    meta: {
                        role: role,
                        accountKey: accountKey,
                        limit: rate.limit,
                        remaining: rate.remaining,
                        resetAt: resetAtIso,
                    },
                });
                return [3 /*break*/, 10];
            case 9:
                err_2 = _c.sent();
                // eslint-disable-next-line no-console
                console.error("[smt-upload] /upload error:", err_2);
                res.status(500).json({
                    ok: false,
                    error: "Upload failed",
                    detail: String((err_2 === null || err_2 === void 0 ? void 0 : err_2.message) || err_2),
                });
                return [3 /*break*/, 10];
            case 10: return [2 /*return*/];
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
