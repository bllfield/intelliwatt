import express, { Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

const UPLOAD_DIR = process.env.SMT_UPLOAD_DIR || "/home/deploy/smt_inbox";
const PORT = Number(process.env.SMT_UPLOAD_PORT || "8080");
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
  process.env.SMT_CUSTOMER_UPLOAD_WINDOW_MS || 30 * 24 * 60 * 60 * 1000,
);

type Counter = {
  count: number;
  windowStart: number;
  limit: number;
  windowMs: number;
};

const counters = new Map<string, Counter>();

function computeKey(role: "admin" | "customer", accountKey: string) {
  return `${role}:${accountKey || "unknown"}`;
}

function getWindowConfig(role: "admin" | "customer") {
  if (role === "admin") {
    return { limit: ADMIN_LIMIT, windowMs: ADMIN_WINDOW_MS };
  }
  return { limit: CUSTOMER_LIMIT, windowMs: CUSTOMER_WINDOW_MS };
}

function checkRateLimit(role: "admin" | "customer", accountKey: string) {
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
    } as const;
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: existing.windowStart + windowMs,
    } as const;
  }

  existing.count += 1;
  counters.set(key, existing);

  return {
    ok: true,
    limit,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.windowStart + windowMs,
  } as const;
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
    const safeOriginal = (file.originalname || "upload.csv").replace(/[\s\\/:*?"<>|]+/g, "_");
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

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "smt-upload-server", uploadDir: UPLOAD_DIR });
});

app.post("/upload", upload.single("file"), (req: Request, res: Response) => {
  try {
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

    const roleRaw = (req.body?.role || "admin").toString().toLowerCase();
    const role: "admin" | "customer" =
      roleRaw === "customer" ? "customer" : "admin";

    const accountKeyRaw =
      (req.body?.accountKey as string | undefined) || req.ip || "unknown";
    const accountKey = accountKeyRaw.toString();

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

    const file = req.file as Express.Multer.File | undefined;
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
          warning: "File stored, but ingest service failed to start",
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
      message: "Upload failed",
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `SMT upload server listening on port ${PORT}, dir=${UPLOAD_DIR}, maxBytes=${MAX_BYTES}`,
  );
});

