"use client";

import { useState } from "react";

interface Props {
  className?: string;
  houseId?: string | null;
}

export default function SmtBillUploadCard({ className, houseId }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  async function uploadBill() {
    if (files.length === 0) {
      setStatus("Select a bill first.");
      return;
    }

    try {
      setIsUploading(true);
      setStatus(null);

      const formData = new FormData();
      files.forEach((file) => formData.append("billFile", file));
      if (houseId && houseId.trim().length > 0) {
        formData.append("houseId", houseId.trim());
      }

      const res = await fetch("/api/current-plan/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(json?.error || "Upload failed. Try again.");
        return;
      }

      const entryAwarded = Boolean(json?.entryAwarded) || Boolean(json?.alreadyAwarded);
      if (entryAwarded && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("entriesUpdated"));
      }

      let parseSucceeded = false;
      if (houseId && houseId.trim().length > 0) {
        try {
          const parseRes = await fetch("/api/current-plan/bill-parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ houseId: houseId.trim() }),
          });
          const parseJson = await parseRes.json().catch(() => null);
          if (parseRes.ok && parseJson?.ok) {
            parseSucceeded = true;
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("smt-init-updated"));
            }
          }
        } catch {
          // best-effort; ignore parse errors for now
        }
      }

      setUploaded(true);
      setStatus(
        entryAwarded
          ? parseSucceeded
            ? "Bill uploaded, entry recorded, and SMT details updated."
            : "Bill uploaded and entry recorded."
          : parseSucceeded
          ? "Bill uploaded and SMT details updated."
          : "Bill uploaded. We will parse and pre-fill your SMT details."
      );
      setFiles([]);
    } catch (err) {
      setStatus("Upload failed. Try again.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div
      className={`rounded-3xl border border-brand-cyan/25 bg-white p-6 shadow-[0_18px_40px_rgba(16,46,90,0.12)] ${className ?? ""}`}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-blue/70">
            Preferred: Upload your utility bill
          </p>
          <h3 className="text-lg font-semibold text-brand-navy">Attach a recent bill to auto-fill SMT</h3>
          <p className="text-sm text-brand-slate">
            We will parse the bill to pre-fill your SMT agreement details (service address, account info, rate plan).
            Once SMT is approved you get the Smart Meter entry, plus we capture usage and plan data.
          </p>
        </div>
        <div className="rounded-full bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_22px_rgba(16,46,90,0.25)]">
          +2 entries when approved
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-5 text-center text-sm text-brand-navy transition hover:border-brand-blue/60 hover:bg-brand-blue/10">
          <span className="font-semibold">Drag a PDF/photo here or click to browse</span>
          <span className="mt-1 text-xs text-brand-slate">PDF, JPG, or PNG</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              if (selected.length === 0) return;

              setFiles((prev) => {
                const merged = [...prev, ...selected];
                // Remove duplicates by name+size to avoid double uploads of the same file
                const seen = new Set<string>();
                return merged.filter((file) => {
                  const key = `${file.name}-${file.size}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
              });
              setUploaded(false);
              setStatus(null);
            }}
          />
        </label>

        {files.length > 0 ? (
          <ul className="space-y-2 rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-3 text-xs text-brand-navy">
            {files.map((file, idx) => (
              <li key={`${file.name}-${file.size}-${idx}`} className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-rose-600 hover:text-rose-700"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={uploadBill}
            disabled={files.length === 0 || isUploading}
            className="inline-flex items-center rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_24px_rgba(16,46,90,0.25)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Uploading…" : uploaded ? "Bill Uploaded ✓" : "Upload bill now"}
          </button>
          {status ? (
            <p className={`text-sm ${uploaded ? "text-emerald-700" : "text-rose-700"}`}>
              {status}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
