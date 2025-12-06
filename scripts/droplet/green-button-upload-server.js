const express = require("express");
const multer = require("multer");
const { createHash, createHmac } = require("node:crypto");
const { Prisma, PrismaClient } = require("@prisma/client");
const { PrismaClient: UsagePrismaClient } = require("../../.prisma/usage-client");
const { parseGreenButtonBuffer } = require("../../app/lib/usage/greenButtonParser");
const { normalizeGreenButtonReadingsTo15Min } = require("../../app/lib/usage/greenButtonNormalize");

const PORT = Number(process.env.GREEN_BUTTON_UPLOAD_PORT || "8091");
const MAX_BYTES = Number(process.env.GREEN_BUTTON_UPLOAD_MAX_BYTES || 500 * 1024 * 1024);
const SECRET = process.env.GREEN_BUTTON_UPLOAD_SECRET || "";
const ALLOW_ORIGIN = process.env.GREEN_BUTTON_UPLOAD_ALLOW_ORIGIN || "https://intelliwatt.com";

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});
const usagePrisma = new UsagePrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_BYTES,
  },
});

const app = express();

function setCorsHeaders(res, origin) {
  if (origin && origin === ALLOW_ORIGIN) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Green-Button-Payload, X-Green-Button-Signature",
  );
}

app.use((req, res, next) => {
  setCorsHeaders(res, req.headers.origin);
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "green-button-upload-server",
    maxBytes: MAX_BYTES,
    allowOrigin: ALLOW_ORIGIN,
  });
});

function verifySignature(payload, signature) {
  if (!SECRET) {
    throw new Error("Green Button upload secret is not configured");
  }
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  return expected === signature;
}

function base64UrlToBuffer(input) {
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  if (padding === 2) {
    normalized += "==";
  } else if (padding === 3) {
    normalized += "=";
  } else if (padding !== 0) {
    throw new Error("Invalid base64url string");
  }
  return Buffer.from(normalized, "base64");
}

function decodePayload(encoded) {
  const buffer = base64UrlToBuffer(encoded);
  const json = buffer.toString("utf8");
  return JSON.parse(json);
}

app.post("/upload", upload.single("file"), async (req, res) => {
  let uploadRecordId = null;
  let rawRecordId = null;
  try {
    if (!SECRET) {
      res.status(500).json({ ok: false, error: "server_not_configured" });
      return;
    }

    const payloadEncoded =
      (req.body && req.body.payload) ||
      (typeof req.headers["x-green-button-payload"] === "string"
        ? req.headers["x-green-button-payload"]
        : undefined);
    const signature =
      (req.body && req.body.signature) ||
      (typeof req.headers["x-green-button-signature"] === "string"
        ? req.headers["x-green-button-signature"]
        : undefined);

    if (!payloadEncoded || !signature) {
      res.status(401).json({ ok: false, error: "missing_signature" });
      return;
    }

    if (!verifySignature(payloadEncoded, signature)) {
      res.status(401).json({ ok: false, error: "invalid_signature" });
      return;
    }

    let payload;
    try {
      payload = decodePayload(payloadEncoded);
    } catch (parseErr) {
      res.status(400).json({
        ok: false,
        error: "invalid_payload",
        detail: String((parseErr && parseErr.message) || parseErr),
      });
      return;
    }

    if (!payload || !payload.userId || !payload.houseId) {
      res.status(400).json({ ok: false, error: "payload_missing_fields" });
      return;
    }

    if (payload.expiresAt) {
      const expiresMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        res.status(401).json({ ok: false, error: "upload_ticket_expired" });
        return;
      }
    }

    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({ ok: false, error: "missing_file" });
      return;
    }

    if (file.buffer.length > MAX_BYTES) {
      res.status(413).json({ ok: false, error: "file_too_large" });
      return;
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: payload.houseId, userId: payload.userId, archivedAt: null },
      select: { id: true, userId: true, utilityName: true },
    });

    if (!house) {
      res.status(404).json({ ok: false, error: "home_not_found" });
      return;
    }

    const buffer = file.buffer;
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const utilityName =
      typeof (req.body && req.body.utilityName) === "string" && req.body.utilityName.trim().length > 0
        ? req.body.utilityName.trim()
        : house.utilityName || null;
    const accountNumber =
      typeof (req.body && req.body.accountNumber) === "string" && req.body.accountNumber.trim().length > 0
        ? req.body.accountNumber.trim()
        : null;
    const filename = (file.originalname && file.originalname.slice(0, 255)) || file.fieldname || "green-button-upload.xml";
    const mimeType = (file.mimetype && file.mimetype.slice(0, 128)) || "application/xml";

    const upserted = await usagePrisma.rawGreenButton.upsert({
      where: { sha256 },
      update: {},
      create: {
        homeId: house.id,
        userId: house.userId,
        utilityName,
        accountNumber,
        filename,
        mimeType,
        sizeBytes: buffer.length,
        content: buffer,
        sha256,
        capturedAt: new Date(),
      },
      select: { id: true },
    });
    rawRecordId = upserted.id;

    if (!rawRecordId) {
      throw new Error("Failed to persist raw Green Button record");
    }

    const storageKey = `usage:raw_green_button:${rawRecordId}`;
    const existingUpload = await prisma.greenButtonUpload.findFirst({
      where: { storageKey },
      select: { id: true },
    });

    const baseUploadData = {
      houseId: house.id,
      utilityName,
      accountNumber,
      fileName: filename,
      fileType: mimeType,
      fileSizeBytes: buffer.length,
      storageKey,
      parseStatus: "processing",
      parseMessage: null,
      dateRangeStart: null,
      dateRangeEnd: null,
      intervalMinutes: null,
    };

    if (existingUpload) {
      uploadRecordId = existingUpload.id;
      await prisma.greenButtonUpload.update({
        where: { id: existingUpload.id },
        data: baseUploadData,
      });
    } else {
      const createdUpload = await prisma.greenButtonUpload.create({
        data: baseUploadData,
      });
      uploadRecordId = createdUpload.id;
    }

    const parsed = parseGreenButtonBuffer(buffer, filename);
    if (parsed.errors.length > 0) {
      if (uploadRecordId) {
        await prisma.greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "error",
            parseMessage: parsed.errors.join("; "),
          },
        });
      }
      res.status(422).json({
        ok: false,
        error: parsed.errors.join("; "),
        warnings: parsed.warnings,
      });
      return;
    }

    if (parsed.readings.length === 0) {
      if (uploadRecordId) {
        await prisma.greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "empty",
            parseMessage: "File parsed but no interval data was found.",
          },
        });
      }
      res.status(422).json({
        ok: false,
        error: "no_readings",
        warnings: parsed.warnings,
      });
      return;
    }

    const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings);
    if (normalized.length === 0) {
      if (uploadRecordId) {
        await prisma.greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "empty",
            parseMessage: "Readings were parsed but could not be normalized to 15-minute intervals.",
          },
        });
      }
      res.status(422).json({
        ok: false,
        error: "normalization_empty",
        warnings: parsed.warnings,
      });
      return;
    }

    const intervalData = normalized.map((interval) => ({
      rawId: rawRecordId,
      homeId: house.id,
      userId: house.userId,
      timestamp: interval.timestamp,
      consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
      intervalMinutes: interval.intervalMinutes,
    }));

    await usagePrisma.$transaction(async (tx) => {
      await tx.greenButtonInterval.deleteMany({ where: { rawId: rawRecordId } });
      if (intervalData.length > 0) {
        await tx.greenButtonInterval.createMany({
          data: intervalData,
        });
      }
    });

    const totalKwh = normalized.reduce((sum, row) => sum + row.consumptionKwh, 0);
    const earliest = normalized[0] ? normalized[0].timestamp : null;
    const latest = normalized[normalized.length - 1]
      ? normalized[normalized.length - 1].timestamp
      : null;

    if (uploadRecordId) {
      const summary = {
        format: parsed.format,
        totalRawReadings: parsed.metadata.totalReadings,
        normalizedIntervals: normalized.length,
        totalKwh: Number(totalKwh.toFixed(6)),
        warnings: parsed.warnings,
      };
      await prisma.greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
          parseMessage: JSON.stringify(summary),
          dateRangeStart: earliest,
          dateRangeEnd: latest,
          intervalMinutes: 15,
        },
      });
    }

    res.status(201).json({
      ok: true,
      rawId: rawRecordId,
      intervalsCreated: normalized.length,
      totalKwh,
      warnings: parsed.warnings,
      dateRangeStart: earliest ? earliest.toISOString() : null,
      dateRangeEnd: latest ? latest.toISOString() : null,
    });
  } catch (error) {
    console.error("[green-button-upload] failed to handle upload", error);
    if (uploadRecordId) {
      try {
        await prisma.greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "error",
            parseMessage: String((error && error.message) || error),
          },
        });
      } catch (updateErr) {
        console.error("[green-button-upload] failed to mark upload error", updateErr);
      }
    }
    res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: String((error && error.message) || error),
    });
  }
});

app.use((err, req, res, _next) => {
  console.error("[green-button-upload] unhandled error", err);
  setCorsHeaders(res, req.headers.origin);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({
    ok: false,
    error: "internal_error",
    detail: String((err && err.message) || err),
  });
});

app.listen(PORT, () => {
  console.log(
    `Green Button upload server listening on port ${PORT}, maxBytes=${MAX_BYTES}, allowOrigin=${ALLOW_ORIGIN}`,
  );
});
