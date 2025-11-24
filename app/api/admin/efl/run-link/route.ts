import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { computePdfSha256 } from "@/lib/efl/eflExtractor";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type RunLinkBody = {
  eflUrl?: string;
  mode?: "test" | "live";
};

type RunLinkSuccess = {
  ok: true;
  mode: "test" | "live";
  eflUrl: string;
  steps: string[];
  pdfSha256: string;
  contentType: string | null;
  contentLength: number | null;
  warnings: string[];
  notes: string;
};

type RunLinkError = {
  ok: false;
  error: string;
  details?: unknown;
};

function jsonError(status: number, error: string, details?: unknown) {
  const body: RunLinkError = {
    ok: false,
    error,
    ...(details ? { details } : {}),
  };

  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: RunLinkBody;
    try {
      body = (await req.json()) as RunLinkBody;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const rawUrl = (body.eflUrl ?? "").trim();
    const mode = body.mode ?? "test";

    if (!rawUrl) {
      return jsonError(400, "Missing required field: eflUrl");
    }

    if (mode !== "test" && mode !== "live") {
      return jsonError(400, 'Invalid mode. Expected "test" or "live".');
    }

    let normalizedUrl: string;
    try {
      const url = new URL(rawUrl);
      normalizedUrl = url.toString();
    } catch (error) {
      return jsonError(400, "Invalid eflUrl", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    let res: Response;
    try {
      res = await fetch(normalizedUrl);
    } catch (error) {
      return jsonError(502, "Failed to fetch EFL PDF", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!res.ok) {
      return jsonError(res.status, "EFL PDF fetch returned non-OK status", {
        status: res.status,
        statusText: res.statusText,
      });
    }

    const contentType = res.headers.get("content-type");
    const contentLengthHeader = res.headers.get("content-length");
    const parsedContentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : null;
    const contentLength = Number.isFinite(parsedContentLength)
      ? parsedContentLength
      : null;

    const warnings: string[] = [];
    if (contentType && !contentType.toLowerCase().includes("pdf")) {
      warnings.push(
        `Content-Type is ${contentType}, which does not look like a PDF.`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);
    const pdfSha256 = computePdfSha256(pdfBytes);

    const steps: string[] = ["downloaded_pdf", "computed_sha256"];
    const notes =
      mode === "test"
        ? "Test mode: no persistence; this endpoint only downloads and fingerprints the EFL PDF."
        : "Live mode: persistence and AI extraction are not wired yet; this endpoint currently behaves like test mode.";

    const payload: RunLinkSuccess = {
      ok: true,
      mode,
      eflUrl: normalizedUrl,
      steps,
      pdfSha256,
      contentType,
      contentLength,
      warnings,
      notes,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return jsonError(500, "Unexpected error in /api/admin/efl/run-link", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

