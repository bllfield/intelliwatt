import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { createHash, createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaClient as UsagePrismaClient } from "../../.prisma/usage-client";

const PORT = Number(process.env.GREEN_BUTTON_UPLOAD_PORT || "8091");
const MAX_BYTES = Number(process.env.GREEN_BUTTON_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
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

function setCorsHeaders(res: Response, origin: string | undefined) {
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

app.use((req: Request, res: Response, next: NextFunction) => {
  setCorsHeaders(res, req.headers.origin as string | undefined);
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "green-button-upload-server",
    maxBytes: MAX_BYTES,
    allowOrigin: ALLOW_ORIGIN,
  });
});

function verifySignature(payload: string, signature: string) {
  if (!SECRET) {
    throw new Error("Green Button upload secret is not configured");
  }
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  return expected === signature;
}

function base64UrlToBuffer(input: string) {
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

type UploadPayload = {
  v: number;
  userId: string;
  houseId: string;
  issuedAt?: string;
  expiresAt?: string;
};

function decodePayload(encoded: string): UploadPayload {
  const buffer = base64UrlToBuffer(encoded);
  const json = buffer.toString("utf8");
  return JSON.parse(json) as UploadPayload;
}

app.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!SECRET) {
      res.status(500).json({
        ok: false,
        error: "server_not_configured",
      });
      return;
    }

    const payloadEncoded =
      (req.body?.payload as string | undefined) ||
      (typeof req.headers["x-green-button-payload"] === "string"
        ? (req.headers["x-green-button-payload"] as string)
        : undefined);
    const signature =
      (req.body?.signature as string | undefined) ||
      (typeof req.headers["x-green-button-signature"] === "string"
        ? (req.headers["x-green-button-signature"] as string)
        : undefined);

    if (!payloadEncoded || !signature) {
      res.status(401).json({
        ok: false,
        error: "missing_signature",
      });
      return;
    }

    if (!verifySignature(payloadEncoded, signature)) {
      res.status(401).json({
        ok: false,
        error: "invalid_signature",
      });
      return;
    }

    let payload: UploadPayload;
    try {
      payload = decodePayload(payloadEncoded);
    } catch (parseErr) {
      res.status(400).json({
        ok: false,
        error: "invalid_payload",
        detail: String((parseErr as Error)?.message || parseErr),
      });
      return;
    }

    if (!payload?.userId || !payload?.houseId) {
      res.status(400).json({
        ok: false,
        error: "payload_missing_fields",
      });
      return;
    }

    if (payload.expiresAt) {
      const expiresMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        res.status(401).json({
          ok: false,
          error: "upload_ticket_expired",
        });
        return;
      }
    }

    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({
        ok: false,
        error: "missing_file",
      });
      return;
    }

    if (file.buffer.length > MAX_BYTES) {
      res.status(413).json({
        ok: false,
        error: "file_too_large",
      });
      return;
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: payload.houseId, userId: payload.userId, archivedAt: null },
      select: { id: true, userId: true, utilityName: true },
    });

    if (!house) {
      res.status(404).json({
        ok: false,
        error: "home_not_found",
      });
      return;
    }

    const buffer = file.buffer;
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const utilityName =
      typeof req.body?.utilityName === "string" && req.body.utilityName.trim().length > 0
        ? req.body.utilityName.trim()
        : house.utilityName ?? null;
    const accountNumber =
      typeof req.body?.accountNumber === "string" && req.body.accountNumber.trim().length > 0
        ? req.body.accountNumber.trim()
        : null;
    const filename =
      file.originalname?.slice(0, 255) || file.fieldname || "green-button-upload.xml";
    const mimeType = file.mimetype?.slice(0, 128) || "application/xml";

    let rawRecordId: string | null = null;
    try {
      const created = await usagePrisma.rawGreenButton.create({
        data: {
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
      rawRecordId = created.id;
    } catch (error: any) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const existing = await usagePrisma.rawGreenButton.findUnique({
          where: { sha256 },
          select: { id: true },
        });
        if (!existing) {
          throw error;
        }
        rawRecordId = existing.id;
      } else {
        throw error;
      }
    }

    if (!rawRecordId) {
      throw new Error("Failed to persist raw Green Button record");
    }

    await (prisma as any).greenButtonUpload.create({
      data: {
        houseId: house.id,
        utilityName,
        accountNumber,
        fileName: filename,
        fileType: mimeType,
        fileSizeBytes: buffer.length,
        storageKey: `usage:raw_green_button:${rawRecordId}`,
        parseStatus: "pending",
        parseMessage: null,
      },
    });

    res.status(201).json({
      ok: true,
      rawId: rawRecordId,
    });
  } catch (error) {
    console.error("[green-button-upload] failed to handle upload", error);
    res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: String((error as Error)?.message || error),
    });
  }
});

app.use(
  (
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ) => {
    console.error("[green-button-upload] unhandled error", err);
    setCorsHeaders(res, req.headers.origin as string | undefined);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: String((err as Error)?.message || err),
    });
  },
);

app.listen(PORT, () => {
  console.log(
    `Green Button upload server listening on port ${PORT}, maxBytes=${MAX_BYTES}, allowOrigin=${ALLOW_ORIGIN}`,
  );
});


