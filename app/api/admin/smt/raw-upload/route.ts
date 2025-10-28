import { NextResponse } from "next/server";
import crypto from "crypto";
import { saveRawSmtFile } from "@/lib/smt/saveRawSmtFile";

type UploadBody = {
  filename: string;
  sourcePath?: string | null;
  size: number;              // bytes
  sha256: string;            // hex string
  bytesBase64: string;       // base64 of entire file
};

export async function POST(request: Request) {
  const corrId = crypto.randomUUID();
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_TOKEN_NOT_CONFIGURED", corrId },
      { status: 503 }
    );
  }

  const hdr = request.headers.get("x-admin-token");
  if (!hdr || hdr !== adminToken) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", corrId },
      { status: 401 }
    );
  }

  let body: UploadBody;
  try {
    body = (await request.json()) as UploadBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", corrId },
      { status: 400 }
    );
  }

  const { filename, sourcePath, size, sha256, bytesBase64 } = body || {};
  if (!filename || !sha256 || !bytesBase64 || typeof size !== "number") {
    return NextResponse.json(
      { ok: false, error: "VALIDATION", details: "Missing required fields", corrId },
      { status: 400 }
    );
  }

  let content: Buffer;
  try {
    content = Buffer.from(bytesBase64, "base64");
  } catch {
    return NextResponse.json(
      { ok: false, error: "BASE64_DECODE_FAILED", corrId },
      { status: 400 }
    );
  }

  if (content.length !== size) {
    return NextResponse.json(
      { ok: false, error: "SIZE_MISMATCH", corrId, details: { size, decoded: content.length } },
      { status: 400 }
    );
  }

  const computed = crypto.createHash("sha256").update(content).digest("hex");
  if (computed.toLowerCase() !== sha256.toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: "SHA256_MISMATCH", corrId, details: { provided: sha256, computed } },
      { status: 400 }
    );
  }

  try {
    const { created, id } = await saveRawSmtFile({
      filename,
      sourcePath: sourcePath ?? null,
      size,
      sha256: computed,
      content,
    });

    return NextResponse.json(
      { ok: true, corrId, id, created },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "DATABASE", corrId },
      { status: 500 }
    );
  }
}

