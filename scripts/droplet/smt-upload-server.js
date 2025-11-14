const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { exec } = require("child_process");

// Core config (all overridable via env)
const UPLOAD_DIR = process.env.SMT_UPLOAD_DIR || "/home/deploy/smt_inbox";
const PORT = Number(process.env.SMT_UPLOAD_PORT || "8081");

// 10 MB default max upload (over your ~5.38 MB file size)
const MAX_BYTES = Number(process.env.SMT_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);

// Optional: shared token so only IntelliWatt frontends can hit this
const UPLOAD_TOKEN = process.env.SMT_UPLOAD_TOKEN || "";

// Rate-limit defaults
// Admin: up to 50 uploads per 24-hour window
const ADMIN_LIMIT = Number(process.env.SMT_ADMIN_UPLOAD_DAILY_LIMIT || "50");
const ADMIN_WINDOW_MS = Number(
  process.env.SMT_ADMIN_UPLOAD_WINDOW_MS || 24 * 60 * 60 * 1000
);

// Customer: up to 5 uploads per ~30-day window
const CUSTOMER_LIMIT = Number(
  process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT || "5"
);
const CUSTOMER_WINDOW_MS = Number(
  process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_WINDOW_MS ||
    30 * 24 * 60 * 60 * 1000
);

// In-memory rate-limit counters
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
  const cfg = getWindowConfig(role);
  const key = computeKey(role, accountKey);
  const now = Date.now();
  const existing = counters.get(key);

  if (!existing || now - existing.windowStart > cfg.windowMs) {
    const fresh = {
      count: 1,
      windowStart: now,
      limit: cfg.limit,
      windowMs: cfg.windowMs,
    };
    counters.set(key, fresh);
    return {
      ok: true,
      limit: cfg.limit,
      remaining: Math.max(cfg.limit - 1, 0),
      resetAt: now + cfg.windowMs,
    };
  }

  if (existing.count >= cfg.limit) {
    return {
      ok: false,
      limit: cfg.limit,
      remaining: 0,
      resetAt: existing.windowStart + cfg.windowMs,
    };
  }

  existing.count += 1;
  counters.set(key, existing);

  return {
    ok: true,
    limit: cfg.limit,
    remaining: Math.max(cfg.limit - existing.count, 0),
    resetAt: existing.windowStart + cfg.windowMs,
  };
}

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ts = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const safeOriginal = file.originalname.replace(/[^\w.\-]+/g, "_");
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

// === CORS middleware so browser can call from https://intelliwatt.com ===
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow only your main site; add preview URLs here later if needed
  const allowedOrigins = [
    "https://intelliwatt.com",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With, x-smt-upload-token"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "smt-upload-server",
    uploadDir: UPLOAD_DIR,
    maxBytes: MAX_BYTES,
  });
});

// Main upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    // Optional shared token check
    if (UPLOAD_TOKEN) {
      const headerToken = req.headers["x-smt-upload-token"];
      if (!headerToken || headerToken !== UPLOAD_TOKEN) {
        return res.status(401).json({
          ok: false,
          error: "unauthorized",
          message: "Invalid or missing SMT upload token",
        });
      }
    }

    const roleRaw = (req.body.role || "admin").toString().toLowerCase();
    const role = roleRaw === "customer" ? "customer" : "admin";

    const accountKey = (req.body.accountKey || req.ip || "unknown").toString();

    const rate = checkRateLimit(role, accountKey);
    if (!rate.ok) {
      return res.status(429).json({
        ok: false,
        error: "rate_limited",
        role,
        accountKey,
        limit: rate.limit,
        remaining: 0,
        resetAt: new Date(rate.resetAt).toISOString(),
        message:
          role === "admin"
            ? "Admin upload limit reached for the current 24-hour window"
            : "Customer upload limit reached for the current 30-day window",
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        ok: false,
        error: "missing_file",
        message: "No file uploaded",
      });
    }

    const ingestService =
      process.env.SMT_INGEST_SERVICE_NAME || "smt-ingest.service";

    exec(`systemctl start ${ingestService}`, (err) => {
      if (err) {
        console.error("Failed to start ingest service:", err);
        return res.status(202).json({
          ok: true,
          stored: true,
          ingestTriggered: false,
          filename: file.filename,
          originalName: file.originalname,
          sizeBytes: file.size,
          role,
          accountKey,
          remaining: rate.remaining,
          warning:
            "File stored, but ingest service failed to start. Check system logs.",
        });
      }

      return res.json({
        ok: true,
        stored: true,
        ingestTriggered: true,
        filename: file.filename,
        originalName: file.originalname,
        sizeBytes: file.size,
        role,
        accountKey,
        limit: rate.limit,
        remaining: rate.remaining,
      });
    });
  } catch (err) {
    console.error("Unexpected error in /upload:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      message: "Upload failed due to an internal error",
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `SMT upload server listening on port ${PORT}, dir=${UPLOAD_DIR}, maxBytes=${MAX_BYTES}`
  );
});

