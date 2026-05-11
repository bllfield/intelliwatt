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
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [pastedAttachments, setPastedAttachments] = useState<File[]>([]);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isParsingPaste, setIsParsingPaste] = useState(false);

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

  async function parsePastedBillText() {
    if (!houseId || houseId.trim().length === 0) {
      setPasteError("We couldn't find your service address. Try refreshing the page and try again.");
      return;
    }
    if (!pastedText.trim()) {
      setPasteError("Paste the visible text from your bill before running the parser.");
      return;
    }

    try {
      setIsParsingPaste(true);
      setPasteError(null);
      let uploadIds: string[] = [];

      if (pastedAttachments.length > 0) {
        const formData = new FormData();
        pastedAttachments.forEach((file) => formData.append("billFile", file));
        formData.append("houseId", houseId.trim());

        const uploadRes = await fetch("/api/current-plan/upload", {
          method: "POST",
          body: formData,
        });
        const uploadJson = await uploadRes.json().catch(() => null);
        if (!uploadRes.ok) {
          setPasteError(
            uploadJson?.error ??
              "We couldn't attach those bill files. Please use actual bill pages, not an app screenshot.",
          );
          return;
        }
        uploadIds = Array.isArray(uploadJson?.uploadIds)
          ? uploadJson.uploadIds
              .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
              .filter(Boolean)
          : [];
      }

      const res = await fetch("/api/current-plan/bill-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId: houseId.trim(),
          textOverride: pastedText.trim(),
          ...(uploadIds.length > 0 ? { uploadIds } : {}),
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setPasteError(
          json?.error ||
            "We couldn't parse that text. Make sure you copied all of the visible bill details and try again.",
        );
        return;
      }

      setShowPasteModal(false);
      setPastedText("");
      setPastedAttachments([]);

      setUploaded(true);
      setStatus(
        uploadIds.length > 0
          ? "Bill text parsed and the original bill files were attached for review. Your SMT details above will refresh shortly."
          : "Bill text parsed. Your SMT details above will refresh shortly.",
      );

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("smt-init-updated"));
      }
    } catch (err: any) {
      setPasteError(
        err?.message ?? "Something went wrong while parsing that text. Please try again.",
      );
    } finally {
      setIsParsingPaste(false);
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
          <span className="font-semibold">Drag your PDF here or click to browse</span>
          <span className="mt-1 text-xs text-brand-slate">
            <span className="font-semibold">PDF is preferred</span>. If your bill is an image or
            screenshot, open it and copy/paste the visible text into the text box instead. If any
            fields are missed, attach the original bill pages or photos so we can review the layout.
            Do not use a utility app/account screenshot in place of the actual bill.
          </span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            multiple={false}
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
          <button
            type="button"
            onClick={() => {
              setShowPasteModal(true);
              setPasteError(null);
            }}
            className="text-xs font-semibold text-brand-blue underline underline-offset-4 hover:text-brand-blue/80"
          >
            Or paste copied bill text instead
          </button>
          {status ? (
            <p className={`text-sm ${uploaded ? "text-emerald-700" : "text-rose-700"}`}>
              {status}
            </p>
          ) : null}
        </div>
      </div>

      {showPasteModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-brand-navy">
                  Paste bill text from an image or PDF
                </h3>
                <p className="mt-1 text-xs text-brand-slate">
                  PDF is preferred. If you only have a screenshot or scanned bill, open it and copy
                  the visible text (provider, plan, address, ESIID, meter, pricing details) into the
                  box below. We&apos;ll run the same parser used for PDF uploads and refresh your SMT
                  details. Attach the original bill pages or photos if you have them. Do not attach a
                  utility app/account screenshot.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="text-xs font-semibold uppercase tracking-wide text-brand-slate hover:text-brand-navy"
              >
                Close
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-brand-navy">
                Optional: attach the original bill pages or photos
              </label>
              <input
                type="file"
                accept=".pdf,application/pdf,image/*"
                multiple
                className="block w-full text-xs text-brand-slate"
                onChange={(e) => {
                  setPastedAttachments(Array.from(e.target.files ?? []));
                }}
              />
              <p className="text-[11px] text-brand-slate">
                Attach the real bill pages or photos you copied from so support can review them if
                any fields are missed. Do not attach a utility app/account screenshot.
              </p>
              {pastedAttachments.length > 0 ? (
                <ul className="rounded-lg border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-[11px] text-brand-navy space-y-1">
                  {pastedAttachments.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`} className="break-all">
                      {file.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              <textarea
                className="h-40 w-full resize-none rounded-lg border border-brand-blue/30 px-3 py-2 text-xs font-mono text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                placeholder="Paste the text from your bill here..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />
              {pasteError && (
                <p className="text-xs text-rose-600">
                  {pasteError}
                </p>
              )}
            </div>

            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="rounded-full border border-brand-slate/40 px-4 py-1.5 text-xs font-semibold text-brand-slate hover:bg-brand-slate/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={parsePastedBillText}
                disabled={isParsingPaste}
                className="rounded-full bg-brand-navy px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_6px_18px_rgba(16,46,90,0.35)] hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isParsingPaste ? "Parsing…" : "Parse pasted text"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
