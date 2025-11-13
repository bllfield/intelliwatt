import { revalidatePath } from "next/cache";

type UploadArgs = {
  file: File;
  esiid?: string;
  meter?: string;
};

export type UploadResult = {
  ok: boolean;
  message?: string;
  error?: string;
  pull?: any;
  normalize?: any;
};

function resolveBaseUrl(): string {
  const explicit = process.env.INTELLIWATT_BASE_URL?.trim();
  if (explicit) return explicit;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    if (vercel.startsWith("http://") || vercel.startsWith("https://")) return vercel;
    return `https://${vercel}`;
  }
  return "http://127.0.0.1:3000";
}

function ensureTrailingSlashRemoved(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function uploadSmtManualCsv({ file, esiid, meter }: UploadArgs): Promise<UploadResult> {
  if (!file) {
    return { ok: false, error: "No file uploaded." };
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return { ok: false, error: "ADMIN_TOKEN is not configured on the server." };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (!buf.length) {
    return { ok: false, error: "Uploaded file is empty." };
  }

  const filename = file.name || "manual.csv";
  const mime = file.type || "text/csv";
  const sizeBytes = buf.byteLength;
  const content_b64 = buf.toString("base64");

  const baseUrl = ensureTrailingSlashRemoved(resolveBaseUrl());
  const capturedAt = new Date().toISOString();

  const inlinePayload = {
    mode: "inline",
    source: "manual_upload",
    filename,
    mime,
    encoding: "base64",
    sizeBytes,
    content_b64,
    esiid,
    meter,
    captured_at: capturedAt,
  };

  const pullRes = await fetch(`${baseUrl}/api/admin/smt/pull`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(inlinePayload),
    cache: "no-store",
  });

  const pullJson = await pullRes.json().catch(() => null);
  if (!pullRes.ok || !pullJson?.ok) {
    return {
      ok: false,
      error:
        pullJson?.error ||
        `Inline pull failed (HTTP ${pullRes.status})${
          pullJson ? `: ${JSON.stringify(pullJson)}` : ""
        }`,
      pull: pullJson,
    };
  }

  const rawId =
    pullJson.id ??
    pullJson.rawId ??
    pullJson.recordId ??
    (Array.isArray(pullJson.files) && pullJson.files[0]?.id) ??
    null;

  const normalizeBody = rawId ? { rawId } : { latest: true };

  const normalizeRes = await fetch(`${baseUrl}/api/admin/smt/normalize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(normalizeBody),
    cache: "no-store",
  });

  const normalizeJson = await normalizeRes.json().catch(() => null);
  if (!normalizeRes.ok || normalizeJson?.ok === false) {
    return {
      ok: false,
      error:
        normalizeJson?.error ||
        `Normalize failed (HTTP ${normalizeRes.status})${
          normalizeJson ? `: ${JSON.stringify(normalizeJson)}` : ""
        }`,
      pull: pullJson,
      normalize: normalizeJson,
    };
  }

  // Refresh the page data (raw files list is client-driven, but this keeps caches fresh if added later).
  revalidatePath("/admin/smt/raw");

  const normalizedCount =
    typeof normalizeJson?.normalized === "number"
      ? normalizeJson.normalized
      : normalizeJson?.files?.length ??
        normalizeJson?.processed ??
        (normalizeJson ? 1 : 0);

  return {
    ok: true,
    message: `Uploaded ${filename} (${sizeBytes.toLocaleString()} bytes) and normalized ${normalizedCount} file(s).`,
    pull: pullJson,
    normalize: normalizeJson,
  };
}

