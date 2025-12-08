import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";

const UPLOAD_DIR = process.env.SMT_UPLOAD_DIR || "/home/deploy/smt_inbox";
const PORT = Number(process.env.SMT_UPLOAD_PORT || "8081");
// Allow up to ~25MB by default so a full 12-month interval CSV (≈35k rows) clears the limit.
const MAX_BYTES = Number(process.env.SMT_UPLOAD_MAX_BYTES || 25 * 1024 * 1024);
const UPLOAD_TOKEN = process.env.SMT_UPLOAD_TOKEN || "";
// Admin limit: 40,000 allows ~365 days of 15-min interval files (96 intervals/day × 365 days = 35,040)
const ADMIN_LIMIT = Number(process.env.SMT_ADMIN_UPLOAD_DAILY_LIMIT || "40000");
const ADMIN_WINDOW_MS = Number(
  process.env.SMT_ADMIN_UPLOAD_WINDOW_MS || 24 * 60 * 60 * 1000,
);
const CUSTOMER_LIMIT = Number(
  process.env.SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT || "5",
);
const CUSTOMER_WINDOW_MS = Number(
  process.env.SMT_CUSTOMER_UPLOAD_WINDOW_MS || 30 * 24 * 60 * 60 * 1000,
);
// No cap here; allow operator to pass huge limits to normalize everything in one run.
const NORMALIZE_LIMIT = Math.max(Number(process.env.SMT_NORMALIZE_LIMIT || "100000"), 1);

// Main app webhook for registering and normalizing uploaded files
const INTELLIWATT_BASE_URL = process.env.INTELLIWATT_BASE_URL || "https://intelliwatt.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

type Counter = {
  count: number;
  windowStart: number;
  limit: number;
  windowMs: number;
};

type QueueStatus = "pending" | "active" | "done" | "error";

type QueueJob = {
  id: string;
  filepath: string;
  filename: string;
  sizeBytes: number;
  role: "admin" | "customer";
  accountKey: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: QueueStatus;
  result?: NormalizeResult;
  error?: string;
};

type DurationSample = { durationMs: number; finishedAt: number };

const counters = new Map<string, Counter>();
const pendingJobs: QueueJob[] = [];
let activeJob: QueueJob | null = null;
const durationHistory: DurationSample[] = [];
const DEFAULT_ESTIMATE_SECONDS = 45;

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

app.use((req: Request, res: Response, next: NextFunction) => {
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

function verifyUploadToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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

async function computeFileSha256(filepath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filepath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function recordPipelineError(status: number, step: string, details: string) {
  if (!ADMIN_TOKEN || !INTELLIWATT_BASE_URL) {
    console.warn('[smt-upload] Cannot record pipeline error: ADMIN_TOKEN or INTELLIWATT_BASE_URL missing');
    return;
  }

  try {
    const trimmedDetails = (details || '').slice(0, 4000);
    const payload = {
      ok: false,
      step,
      status,
      details: trimmedDetails,
      recordedAt: new Date().toISOString(),
    };
    const content = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(content, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentBase64 = buffer.toString('base64');

    const body = {
      filename: `smt-upload-error-${step}-${status}.json`,
      sizeBytes: buffer.length,
      sha256,
      contentBase64,
      source: 'droplet-error',
      receivedAt: new Date().toISOString(),
    };

    const rawUploadUrl = `${INTELLIWATT_BASE_URL}/api/admin/smt/raw-upload`;
    console.warn(`[smt-upload] recording pipeline error at ${rawUploadUrl} status=${status} step=${step}`);

    const resp = await fetch(rawUploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn(`[smt-upload] failed to record pipeline error: ${resp.status} ${text}`);
    }
  } catch (err) {
    console.warn('[smt-upload] exception while recording pipeline error:', err);
  }
}

type NormalizeResult = {
  ok: boolean;
  message: string;
  filesProcessed?: number;
  intervalsInserted?: number;
  normalized?: boolean;
};

function pruneDurations(now: number) {
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  while (durationHistory.length && durationHistory[0].finishedAt < sevenDaysAgo) {
    durationHistory.shift();
  }
}

function longestDurationMs(windowMs: number) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let max = 0;
  for (const sample of durationHistory) {
    if (sample.finishedAt >= cutoff && sample.durationMs > max) {
      max = sample.durationMs;
    }
  }
  return max;
}

function averageDurationSeconds() {
  if (durationHistory.length === 0) return DEFAULT_ESTIMATE_SECONDS;
  const total = durationHistory.reduce((sum, s) => sum + s.durationMs, 0);
  return Math.max(Math.round(total / durationHistory.length / 1000), 1);
}

function queuePosition(jobId: string) {
  const idx = pendingJobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return activeJob?.id === jobId ? 0 : -1;
  return idx + 1 + (activeJob ? 1 : 0);
}

async function processQueue() {
  if (activeJob || pendingJobs.length === 0) {
    return;
  }

  const job = pendingJobs.shift();
  if (!job) return;
  activeJob = { ...job, status: "active", startedAt: Date.now() };

  // eslint-disable-next-line no-console
  console.log(`[smt-upload] processing job ${activeJob.id} file=${activeJob.filename} bytes=${activeJob.sizeBytes}`);

  try {
    const result = await registerAndNormalizeFile(job.filepath, job.filename, job.sizeBytes);
    const finishedAt = Date.now();
    const durationMs = activeJob.startedAt ? finishedAt - activeJob.startedAt : 0;
    durationHistory.push({ durationMs, finishedAt });
    pruneDurations(finishedAt);

    activeJob = {
      ...activeJob,
      finishedAt,
      status: result.ok ? "done" : "error",
      result,
      error: result.ok ? undefined : result.message,
    };

    // eslint-disable-next-line no-console
    console.log(
      `[smt-upload] job ${activeJob.id} complete status=${activeJob.status} durationMs=${durationMs} filesProcessed=${result.filesProcessed ?? 0} intervalsInserted=${result.intervalsInserted ?? 0}`,
    );
  } catch (err) {
    const finishedAt = Date.now();
    activeJob = {
      ...activeJob,
      finishedAt,
      status: "error",
      error: String((err as Error)?.message || err),
    };
    // eslint-disable-next-line no-console
    console.error(`[smt-upload] job ${activeJob.id} failed:`, err);
  } finally {
    activeJob = null;
    // Kick the next job.
    void processQueue();
  }
}

function enqueueJob(job: QueueJob) {
  pendingJobs.push(job);
  // eslint-disable-next-line no-console
  console.log(
    `[smt-upload] queued job id=${job.id} file=${job.filename} size=${job.sizeBytes} pending=${pendingJobs.length} active=${activeJob ? 1 : 0}`,
  );
  void processQueue();
}

async function registerAndNormalizeFile(
  filepath: string,
  filename: string,
  size_bytes: number,
): Promise<NormalizeResult> {
  if (!ADMIN_TOKEN || !INTELLIWATT_BASE_URL) {
    console.warn(
      "[smt-upload] Cannot register file: ADMIN_TOKEN or INTELLIWATT_BASE_URL not configured",
    );
    return {
      ok: false,
      message: "ADMIN_TOKEN or INTELLIWATT_BASE_URL not configured",
    };
  }

  let deleted = false;

  try {
    // STEP 3: Large-file SMT ingestion - read file, send content, normalize, then delete
    const sha256 = await computeFileSha256(filepath);
    // eslint-disable-next-line no-console
    console.log(
      `[smt-upload] computed sha256=${sha256} for file=${filepath}`,
    );

    // Read file content and encode as base64
    const fileContent = await fs.promises.readFile(filepath);
    const contentBase64 = fileContent.toString('base64');
    // eslint-disable-next-line no-console
    console.log(
      `[smt-upload] read file content: ${fileContent.length} bytes, base64 length: ${contentBase64.length}`,
    );

    // Step 1: Register the raw file with the main app (including content)
    const rawUploadUrl = `${INTELLIWATT_BASE_URL}/api/admin/smt/raw-upload`;
    const rawUploadPayload = {
      filename,
      sizeBytes: size_bytes,
      sha256,
      contentBase64,
      source: "droplet-upload",
      receivedAt: new Date().toISOString(),
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
      signal: AbortSignal.timeout(30000), // 30 second timeout for registration
    });

    if (!rawResponse.ok) {
      const errBody = await rawResponse.text();
      console.error(
        `[smt-upload] raw-upload failed: ${rawResponse.status} ${errBody}`,
      );
      await recordPipelineError(rawResponse.status, 'raw-upload', errBody);
      return {
        ok: false,
        message: `raw-upload failed: ${rawResponse.status}`,
      };
    }

    const rawResult = await rawResponse.json();
    // eslint-disable-next-line no-console
    console.log(`[smt-upload] raw file registered: ${JSON.stringify(rawResult)}`);

    const isDuplicate = rawResult?.duplicate === true || rawResult?.status === "duplicate";
    if (isDuplicate) {
      // Skip normalization to avoid hammering the API when nothing new will ingest.
      return {
        ok: true,
        message: "duplicate raw file; normalization skipped",
        filesProcessed: 0,
        intervalsInserted: 0,
        normalized: false,
      };
    }

    // Step 2: Trigger normalization of the raw file
    const normalizeUrl = `${INTELLIWATT_BASE_URL}/api/admin/smt/normalize?limit=${NORMALIZE_LIMIT}`;
    // eslint-disable-next-line no-console
    console.log(`[smt-upload] triggering normalization at ${normalizeUrl}`);

    const normResponse = await fetch(normalizeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(300000), // 5 minute timeout for normalization (large files)
    });

    if (!normResponse.ok) {
      const errBody = await normResponse.text();
      console.error(
        `[smt-upload] normalize failed: ${normResponse.status} ${errBody}`,
      );
      await recordPipelineError(normResponse.status, 'normalize', errBody);
      return {
        ok: false,
        message: `normalize failed: ${normResponse.status}`,
      };
    }

    const normResult = await normResponse.json();
    const filesProcessed = normResult.filesProcessed || 0;
    const intervalsInserted = normResult.intervalsInserted || 0;
    // eslint-disable-next-line no-console
    console.log(
      `[smt-upload] normalization complete: filesProcessed=${filesProcessed} intervalsInserted=${intervalsInserted}`,
    );

    return {
      ok: true,
      message: "normalize complete",
      filesProcessed,
      intervalsInserted,
      normalized: true,
    };
  } catch (err) {
    console.error("[smt-upload] error during registration/normalization:", err);
    await recordPipelineError(0, 'pipeline-error', String((err as Error)?.message || err));
    return {
      ok: false,
      message: `normalize error: ${(err as Error)?.message || err}`,
    };
  } finally {
    try {
      await fs.promises.unlink(filepath);
      deleted = true;
      // eslint-disable-next-line no-console
      console.log(`[smt-upload] deleted local file (cleanup): ${filepath}`);
    } catch (unlinkErr) {
      if (!deleted) {
        // eslint-disable-next-line no-console
        console.warn(`[smt-upload] warning: failed to delete local file ${filepath}:`, unlinkErr);
      }
    }
  }
}

function isIntervalFile(name: string) {
  return /interval/i.test(name);
}

app.use((req: Request, res: Response, next: NextFunction) => {
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "smt-upload-server",
    uploadDir: UPLOAD_DIR,
    maxBytes: MAX_BYTES,
  });
});

app.get("/queue/summary", (_req: Request, res: Response) => {
  const avgSeconds = averageDurationSeconds();
  const longestDay = Math.round(longestDurationMs(24 * 60 * 60 * 1000) / 1000);
  const longestWeek = Math.round(longestDurationMs(7 * 24 * 60 * 60 * 1000) / 1000);

  res.json({
    ok: true,
    pending: pendingJobs.length,
    active: activeJob ? 1 : 0,
    averageSecondsPerFile: avgSeconds,
    longestSecondsLastDay: longestDay,
    longestSecondsLastWeek: longestWeek,
    activeJob: activeJob
      ? {
          id: activeJob.id,
          filename: activeJob.filename,
          sizeBytes: activeJob.sizeBytes,
          startedAt: activeJob.startedAt,
        }
      : null,
    nextJob: pendingJobs[0]
      ? {
          id: pendingJobs[0].id,
          filename: pendingJobs[0].filename,
          sizeBytes: pendingJobs[0].sizeBytes,
          queuedAt: pendingJobs[0].createdAt,
        }
      : null,
    samplesRecorded: durationHistory.length,
  });
});

app.post(
  "/upload",
  verifyUploadToken,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const roleHeader = req.headers["x-smt-upload-role"];
    const accountHeader = req.headers["x-smt-upload-account-key"];
    const roleRaw =
      (req.body?.role as string | undefined) ||
      (typeof roleHeader === "string" ? roleHeader : Array.isArray(roleHeader) ? roleHeader[0] : undefined) ||
      "admin";
    const role: "admin" | "customer" =
      roleRaw.toString().toLowerCase() === "customer" ? "customer" : "admin";

    const accountKeyRaw =
      (req.body?.accountKey as string | undefined) ||
      (typeof accountHeader === "string"
        ? accountHeader
        : Array.isArray(accountHeader)
          ? accountHeader[0]
          : undefined) ||
      req.ip ||
      "unknown";
    const accountKey = accountKeyRaw.toString();

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
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        console.warn("[smt-upload] No file in request (field \"file\" missing)");
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
          : undefined) ||
        0;

      const originalName = file.originalname || file.filename || "upload.csv";
      const intervalFile = isIntervalFile(originalName);

      // eslint-disable-next-line no-console
      console.log(
        `[smt-upload] saved file=${destPath} bytes=${sizeGuess ?? "n/a"} role=${role} accountKey=${accountKey} interval=${intervalFile}`,
      );

      let responseMessage = "Upload accepted and ingest triggered";
      let responseOk = true;

      if (!intervalFile) {
        // Drop non-interval files immediately so the droplet doesn't fill up
        try {
          await fs.promises.unlink(destPath);
          // eslint-disable-next-line no-console
          console.log(`[smt-upload] deleted non-interval file: ${originalName}`);
        } catch (unlinkErr) {
          // eslint-disable-next-line no-console
          console.warn(`[smt-upload] warning: failed to delete non-interval file ${destPath}:`, unlinkErr);
        }

        responseMessage = "Upload ignored (non-interval file removed)";
      } else {
        const job: QueueJob = {
          id: crypto.randomUUID(),
          filepath: destPath,
          filename: originalName,
          sizeBytes: sizeGuess,
          role,
          accountKey,
          createdAt: Date.now(),
          status: "pending",
        };

        enqueueJob(job);

        const position = queuePosition(job.id);
        const avgSeconds = averageDurationSeconds();
        const etaSeconds = Math.max((position <= 0 ? 1 : position) * avgSeconds, avgSeconds);

        responseMessage = "Upload accepted and queued";
        responseOk = true;

        res.status(202).json({
          ok: true,
          message: responseMessage,
          file: {
            name: originalName,
            size: sizeGuess ?? null,
            path: destPath,
            interval: intervalFile,
          },
          meta: {
            role,
            accountKey,
            limit: rate.limit,
            remaining: rate.remaining,
            resetAt: resetAtIso,
          },
          queue: {
            jobId: job.id,
            position,
            etaSeconds,
            averageSecondsPerFile: avgSeconds,
            pending: pendingJobs.length,
            active: activeJob ? 1 : 0,
          },
        });
        return;
      }

      res.status(responseOk ? 202 : 500).json({
        ok: responseOk,
        message: responseMessage,
        file: {
          name: originalName,
          size: sizeGuess ?? null,
          path: destPath,
          interval: intervalFile,
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
        detail: String((err as Error)?.message || err),
      });
    }
  },
);

app.use(
  (
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ) => {
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
      detail: String((err as Error)?.message || err),
    });
  },
);

// Lightweight keep-alive timer so the process never exits unexpectedly.
setInterval(() => {
  // eslint-disable-next-line no-console
  console.log("[smt-upload] keep-alive tick");
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `SMT upload server listening on port ${PORT}, dir=${UPLOAD_DIR}, maxBytes=${MAX_BYTES}`,
  );
});

