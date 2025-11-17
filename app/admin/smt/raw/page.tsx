import { headers } from "next/headers";
import { NormalizeLatestButton } from "@/components/admin/smt/NormalizeLatestButton";
import AdminSmtRawClient from "./RawClient";
import ManualUploadForm from "./ManualUploadForm";

export const dynamic = "force-dynamic";

function resolveBaseUrl() {
  const explicit =
    process.env.ADMIN_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.PROD_BASE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "";

  if (explicit) {
    try {
      return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
    } catch {
      // fall through and try to resolve from incoming headers instead
    }
  }

  const incoming = headers();
  const host = incoming.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return new URL(`${protocol}://${host}`);
}

export default function AdminSmtRawPage() {
  async function normalizeLatestAction(payload: { esiid?: string }) {
    "use server";

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      throw new Error("ADMIN_TOKEN is not configured on the server.");
    }

    const baseUrl = resolveBaseUrl();
    const body: { latest: true; esiid?: string } = { latest: true };
    if (payload?.esiid) {
      body.esiid = payload.esiid;
    }

    const response = await fetch(new URL("/api/admin/smt/normalize", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await response.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Normalize endpoint returned non-JSON response (HTTP ${response.status}).`);
      }
    }

    if (!response.ok || json?.ok === false) {
      const detail = json?.error || json?.message;
      throw new Error(detail ? `Normalize failed: ${detail}` : `Normalize failed (HTTP ${response.status}).`);
    }

    return json;
  }

  return (
    <div className="space-y-10 pb-10">
      <ManualUploadForm />
      <NormalizeLatestButton action={normalizeLatestAction} />
      <AdminSmtRawClient />
    </div>
  );
}

