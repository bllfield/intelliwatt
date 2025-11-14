const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const UPLOAD_DIR = process.env.SMT_UPLOAD_DIR || "/home/deploy/smt_inbox";
const PORT = Number(process.env.SMT_UPLOAD_PORT || "8081");
const MAX_BYTES = Number(process.env.SMT_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const UPLOAD_TOKEN = process.env.SMT_UPLOAD_TOKEN || "";
const ADMIN_LIMIT = Number(process.env.SMT_ADMIN_UPLOAD_DAILY_LIMIT || "50");
const ADMIN_WINDOW_MS = Number(
  process.env.SMT_ADMIN_UPLOAD_WINDOW_MS || 24 * 60 * 60 * 1000,
);
const CUSTOMER_LIMIT = Number(
  process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT || "5",
);
const CUSTOMER_WINDOW_MS = Number(
  process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_WINDOW_MS ||
    30 * 24 * 60 * 60 * 1000,
);

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
    const counter = {
      count: 1,
      windowStart: now,
      limit,
      windowMs,
    };
    counters.set(key, counter);
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

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ts = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const safeOriginal =
      (file.originalname || "upload.csv").replace(/[\s\\/:*?"<>|]+/g, "_");
    cb(null, `${ts}_${safeOriginal}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_BYTES,
  },
});

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === "https://intelliwatt.com") {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, x-smt-upload-role, x-smt-upload-account-key, x-smt-upload-token",
  );

  const len = req.headers["content-length"];
  // eslint-disable-next-line no-console
  console.log(
    `[smt-upload] ${req.method} ${req.url} origin=${origin || "n/a"} content-length=${len || "n/a"}`,
  );

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
  if (
    (typeof headerToken === "string" && headerToken === UPLOAD_TOKEN) ||
    (Array.isArray(headerToken) && headerToken.includes(UPLOAD_TOKEN))
  ) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: "unauthorized",
    message: "Invalid or missing SMT upload token",
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "smt-upload-server",
    uploadDir: UPLOAD_DIR,
    maxBytes: MAX_BYTES,
  });
});

app.post(
  "/upload",
  verifyUploadToken,
  upload.single("file"),
  async (req, res) => {
    const roleHeader = req.headers["x-smt-upload-role"];
    const accountHeader = req.headers["x-smt-upload-account-key"];
    const roleRaw =
      (req.body && req.body.role) ||
      (typeof roleHeader === "string"
        ? roleHeader
        : Array.isArray(roleHeader)
          ? roleHeader[0]
          : undefined) ||
      "admin";
    const role =
      String(roleRaw).toLowerCase() === "customer" ? "customer" : "admin";

    const accountKeyRaw =
      (req.body && req.body.accountKey) ||
      (typeof accountHeader === "string"
        ? accountHeader
        : Array.isArray(accountHeader)
          ? accountHeader[0]
          : undefined) ||
      req.ip ||
      "unknown";
    const accountKey = String(accountKeyRaw);

    // eslint-disable-next-line no-console
    console.log(
      `[smt-upload] /upload start role=${role} accountKey=${accountKey} hasFile=${req.file ? "true" : "false"}`,
    );

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
        message:
          role === "admin"
            ? "Admin upload limit reached for the current 24-hour window"
            : "Customer upload limit reached for the current 30-day window",
      });
      return;
    }

    try {
      const file = req.file;
      if (!file) {
        console.warn('[smt-upload] No file in request (field "file" missing)');
        res.status(400).json({
          ok: false,
          error: 'Missing file field "file"',
        });
        return;
      }

      const destPath = path.join(
        UPLOAD_DIR,
        file.filename || file.originalname || "upload.csv",
      );
      try {
        if (file.path && file.path !== destPath) {
          await fs.promises.rename(file.path, destPath);
        } else if (!file.path && file.buffer) {
          await fs.promises.writeFile(destPath, file.buffer);
        }
      } catch (writeErr) {
        // eslint-disable-next-line no-console
        console.error("[smt-upload] Failed to persist file:", writeErr);
        throw writeErr;
      }

      const sizeGuess =
        (typeof file.size === "number" ? file.size : undefined) ||
        (typeof req.headers["content-length"] === "string"
          ? Number(req.headers["content-length"])
          : undefined);

      // eslint-disable-next-line no-console
      console.log(
        `[smt-upload] saved file=${destPath} bytes=${sizeGuess ?? "n/a"} role=${role} accountKey=${accountKey}`,
      );

      const ingestService =
        process.env.SMT_INGEST_SERVICE_NAME || "smt-ingest.service";

      try {
        const child = spawn("systemctl", ["start", ingestService], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        // eslint-disable-next-line no-console
        console.log(
          `[smt-upload] triggered systemctl start ${ingestService}`,
        );
      } catch (serviceErr) {
        // eslint-disable-next-line no-console
        console.error(
          "[smt-upload] failed to trigger smt-ingest.service:",
          serviceErr,
        );
      }

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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[smt-upload] /upload error:", err);
      res.status(500).json({
        ok: false,
        error: "Upload failed",
        detail: String((err && err.message) || err),
      });
    }
  },
);

app.use((err, req, res, _next) => {
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
    detail: String((err && err.message) || err),
  });
});

// Lightweight keep-alive timer so the process never exits unexpectedly.
// This should be effectively no-op but ensures at least one active timer handle.
setInterval(() => {
  // eslint-disable-next-line no-console
  console.log("[smt-upload] keep-alive tick");
}, 60 * 60 * 1000); // once per hour

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `SMT upload server listening on port ${PORT}, dir=${UPLOAD_DIR}, maxBytes=${MAX_BYTES}`,
  );
});

