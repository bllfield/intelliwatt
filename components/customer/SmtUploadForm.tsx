"use client";

import { FormEvent, useState } from "react";

type SmtUploadFormProps = {
  uploadUrl?: string;
};

type UploadStatus = {
  message: string;
  tone: "info" | "success" | "error";
};

export default function SmtUploadForm({ uploadUrl }: SmtUploadFormProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<UploadStatus | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!uploadUrl) {
      setStatus({
        message: "Upload service is not configured. Please try again later.",
        tone: "error",
      });
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file") as File | null;
    const accountKeyRaw = (formData.get("accountKey") as string | null) || "";
    const accountKey = accountKeyRaw.trim();

    if (!file || file.size === 0) {
      setStatus({ message: "Choose a CSV file before uploading.", tone: "error" });
      return;
    }

    if (!accountKey) {
      setStatus({
        message: "Enter your Home ID or account reference before uploading.",
        tone: "error",
      });
      return;
    }

    formData.set("role", "customer");
    formData.set("accountKey", accountKey);

    setBusy(true);
    setStatus({ message: "Uploading…", tone: "info" });

    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
        mode: "cors",
        credentials: "omit",
      });

      const rawText = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        // keep raw text for error fallback
      }

      if (!response.ok) {
        if (response.status === 429 && json) {
          const resetAt = json.resetAt ? `Window resets at ${json.resetAt}.` : "Please try again later.";
          setStatus({
            message: `Upload limit reached (${json.limit} per window). ${resetAt}`,
            tone: "error",
          });
        } else if (json?.message) {
          setStatus({ message: `Upload failed: ${json.message}`, tone: "error" });
        } else {
          setStatus({
            message: `Upload failed (HTTP ${response.status}): ${rawText || "see droplet logs"}`,
            tone: "error",
          });
        }
        return;
      }

      if (json?.ok) {
        const remaining =
          typeof json.remaining === "number"
            ? ` Remaining uploads this window: ${json.remaining}.`
            : "";
        setStatus({
          message: `Upload complete. Your file has been queued for processing.${remaining}`,
          tone: "success",
        });
        form.reset();
      } else {
        setStatus({
          message: "Upload succeeded but response format was unexpected.",
          tone: "error",
        });
      }
    } catch (err: any) {
      setStatus({
        message: `Upload failed: ${err?.message || "Unknown error"}`,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} encType="multipart/form-data" className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Home ID or Account Reference</label>
          <input
            type="text"
            name="accountKey"
            placeholder="e.g., HOME-12345"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            We use this to route the file to the correct home and enforce per-customer upload limits.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">SMT CSV file (12-month interval)</label>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Upload the full 12-month interval CSV downloaded from Smart Meter Texas. Large files are supported.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded bg-black text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload CSV"}
          </button>
          <p className="text-xs text-gray-500">
            You can upload up to 5 files per month. If you reach the limit, please contact support.
          </p>
        </div>
      </form>

      {status ? (
        <div
          className={`rounded border px-3 py-2 text-sm ${
            status.tone === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : status.tone === "error"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
          }`}
        >
          {status.message}
        </div>
      ) : null}

      {!uploadUrl ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          Upload server is not configured. Set <code>NEXT_PUBLIC_SMT_UPLOAD_URL</code> to enable uploads.
        </div>
      ) : null}
    </div>
  );
}
