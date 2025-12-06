"use client";

import { useEffect, useRef, useState } from "react";

interface GreenButtonHelpSectionProps {
  houseAddressId?: string | null;
  defaultUtilityName?: string | null;
}

export default function GreenButtonHelpSection({
  houseAddressId,
  defaultUtilityName,
}: GreenButtonHelpSectionProps) {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [utilityName, setUtilityName] = useState(defaultUtilityName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUtilityName(defaultUtilityName ?? "");
  }, [defaultUtilityName]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xml") && !lower.endsWith(".csv")) {
      setStatusTone("error");
      setStatusMessage("Select a Green Button XML or CSV file.");
      event.target.value = "";
      setSelectedFile(null);
      return;
    }

    setStatusTone(null);
    setStatusMessage(null);
    setSelectedFile(file);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!houseAddressId) {
      setStatusTone("error");
      setStatusMessage("Add your service address first so we can link this upload.");
      return;
    }
    if (!selectedFile) {
      setStatusTone("error");
      setStatusMessage("Select a Green Button XML or CSV file to upload.");
      return;
    }

    try {
      setIsUploading(true);
      setStatusTone(null);
      setStatusMessage("Uploading your usage file…");

      const trimmedUtility = utilityName.trim();
      const trimmedAccount = accountNumber.trim();
      let uploadCompleted = false;

      const attemptDropletUpload = async () => {
        try {
          const ticketRes = await fetch("/api/green-button/upload-ticket", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ homeId: houseAddressId }),
          });

          if (!ticketRes.ok) {
            return false;
          }

          const ticket = await ticketRes.json();
          if (!ticket?.ok || !ticket?.uploadUrl || !ticket?.payload || !ticket?.signature) {
            return false;
          }

          const dropletForm = new FormData();
          dropletForm.append("file", selectedFile);
          dropletForm.append("payload", ticket.payload);
          dropletForm.append("signature", ticket.signature);
          if (trimmedUtility.length > 0) {
            dropletForm.append("utilityName", trimmedUtility);
          }
          if (trimmedAccount.length > 0) {
            dropletForm.append("accountNumber", trimmedAccount);
          }

          const dropletResponse = await fetch(ticket.uploadUrl as string, {
            method: "POST",
            body: dropletForm,
            credentials: "omit",
          });

          if (!dropletResponse.ok) {
            const data = await dropletResponse.json().catch(() => ({}));
            const detail =
              typeof data?.error === "string"
                ? data.error
                : "Upload failed on the secure uploader. Falling back to direct upload.";
            setStatusTone("error");
            setStatusMessage(detail);
            return false;
          }

          uploadCompleted = true;
          return true;
        } catch (err) {
          console.error("[GreenButtonHelpSection] droplet upload failed", err);
          return false;
        }
      };

      const triggerUsageRefresh = async () => {
        try {
          const refreshRes = await fetch('/api/user/usage/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ homeId: houseAddressId }),
          });
          if (!refreshRes.ok) {
            const detail = await refreshRes.text().catch(() => '');
            console.warn('Usage refresh after Green Button upload failed', refreshRes.status, detail);
          }
        } catch (refreshError) {
          console.error('Usage refresh post-upload encountered an error', refreshError);
        }
      };

      const dropletSuccess = await attemptDropletUpload();
      if (dropletSuccess) {
        await triggerUsageRefresh();
        setStatusTone("success");
        setStatusMessage("Upload received! We’ll start parsing your usage data shortly.");
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        uploadCompleted = true;
      }

      if (!uploadCompleted) {
        const fallbackForm = new FormData();
        fallbackForm.append("file", selectedFile);
        fallbackForm.append("homeId", houseAddressId);
        if (trimmedUtility.length > 0) {
          fallbackForm.append("utilityName", trimmedUtility);
        }
        if (trimmedAccount.length > 0) {
          fallbackForm.append("accountNumber", trimmedAccount);
        }

        const response = await fetch("/api/green-button/upload", {
          method: "POST",
          body: fallbackForm,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const detail = typeof data?.error === "string" ? data.error : "Upload failed. Please try again.";
          setStatusTone("error");
          setStatusMessage(detail);
          return;
        }

        await triggerUsageRefresh();
        setStatusTone("success");
        setStatusMessage("Upload received! We’ll start parsing your usage data shortly.");
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    } catch (error) {
      console.error("[GreenButtonHelpSection] upload failed", error);
      setStatusTone("error");
      setStatusMessage("Upload failed. Please check your connection and try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section
      id="green-button-instructions"
      className="rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-[0_24px_70px_rgba(16,46,90,0.08)] sm:p-8 space-y-6 text-sm leading-relaxed text-brand-slate"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-brand-navy">
            Green Button usage data
          </h2>
          <p className="mt-2">
            Green Button is a standardized download offered by many utilities so you can export the
            same detailed usage history they see internally. Uploading it here lets IntelliWatt
            analyze your real consumption patterns without waiting on Smart Meter Texas.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-semibold text-brand-navy">How to download your Green Button file</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Log in to your electric utility’s online account.</li>
            <li>
              Browse to sections labeled{" "}
              <span className="font-semibold">Usage</span>,{" "}
              <span className="font-semibold">Energy Use</span>,{" "}
              <span className="font-semibold">Usage History</span>, or a{" "}
              <span className="font-semibold">Green Button / Download My Data</span> link.
            </li>
            <li>
              When prompted for a date range, choose the{" "}
              <span className="font-semibold">last 12 months</span> whenever possible. For newer
              homes, export as much history as you have.
            </li>
            <li>
              Download the file—preferably the Green Button{" "}
              <span className="font-semibold">XML</span>. If XML isn’t offered, download the
              available Green Button CSV instead.
            </li>
            <li>
              Return to the <span className="font-semibold">Green Button Upload</span> step below and
              upload that file so we can run the analysis.
            </li>
          </ol>
        </div>

        <div className="space-y-1">
          <p className="font-semibold text-brand-navy">How much data should I upload?</p>
          <p>
            Uploading a full <span className="font-semibold">12 months</span> captures both summer
            and winter usage peaks. If you do not have a year of history yet, send everything
            available—we will still model your savings using what you provide.
          </p>
        </div>

        <div className="space-y-1">
          <p className="font-semibold text-brand-navy">If you can’t find Green Button</p>
          <p>
            Utilities sometimes relabel it as{" "}
            <span className="font-semibold">Energy Insights</span>,{" "}
            <span className="font-semibold">Usage History</span>, or{" "}
            <span className="font-semibold">Download My Usage</span>. If you still can’t locate an
            export, contact your utility’s support team and ask how to download your data in Green
            Button format.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold text-brand-navy">
              Which utilities support Green Button?
            </h3>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center rounded-full border border-brand-navy/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition hover:border-brand-navy/60 hover:bg-brand-navy/5"
              style={{ color: "#39FF14" }}
            >
              View utilities &amp; directory
            </button>
          </div>
          <p>
            Green Button is available from many utilities across the U.S. and Canada. If your
            provider supports it, you can download a standardized usage file from their portal and
            upload it here for IntelliWatt to analyze.
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-3xl border border-brand-navy/10 bg-brand-navy/5 p-5">
        <h4 className="text-base font-semibold text-brand-navy">
          Upload your Green Button file
        </h4>

        {!houseAddressId ? (
          <p className="text-sm text-brand-slate">
            Add your service address above to unlock the Green Button uploader.
          </p>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <label htmlFor="green-button-file" className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy">
                File (XML or CSV · large uploads supported)
              </label>
              <input
                id="green-button-file"
                ref={fileInputRef}
                type="file"
                accept=".xml,.csv,application/xml,text/csv"
                onChange={handleFileChange}
                className="w-full rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                disabled={isUploading}
              />
              {selectedFile ? (
                <p className="text-xs text-brand-slate">
                  {selectedFile.name} · {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="green-button-utility" className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy">
                  Utility name
                </label>
                <input
                  id="green-button-utility"
                  type="text"
                  value={utilityName}
                  onChange={(event) => setUtilityName(event.target.value)}
                  placeholder="e.g. Oncor, CenterPoint"
                  className="rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                  disabled={isUploading}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="green-button-account" className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy">
                  Account number (optional)
                </label>
                <input
                  id="green-button-account"
                  type="text"
                  value={accountNumber}
                  onChange={(event) => setAccountNumber(event.target.value)}
                  placeholder="Last few digits help us match the file"
                  className="rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                  disabled={isUploading}
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="submit"
                disabled={isUploading || !selectedFile}
                className="inline-flex items-center justify-center rounded-full bg-brand-navy px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-[0_10px_35px_rgba(16,46,90,0.18)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? "Uploading…" : "Upload usage file"}
              </button>
              <p className="text-xs text-brand-slate">
                We’ll store the raw file securely in your usage vault and parse it for interval data.
              </p>
            </div>
          </form>
        )}

        {statusMessage ? (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              statusTone === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : statusTone === "error"
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : "border-brand-navy/20 bg-white text-brand-slate"
            }`}
          >
            {statusMessage}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-brand-navy/40 bg-white p-5 shadow-[0_28px_80px_rgba(16,46,90,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-brand-navy">
                  Utilities with Green Button support
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-brand-slate">
                  The official Green Button Directory maintains the list of utilities offering
                  Green Button Download My Data or Connect My Data. Use it to confirm whether your
                  provider supports Green Button.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-brand-slate transition hover:text-brand-navy"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <p className="font-semibold text-brand-navy">Official Green Button Directory</p>
                <p className="text-brand-slate">
                  Search the directory by utility name to check if they offer Green Button:
                </p>
                <a
                  href="https://www.greenbuttonalliance.org/ds-utilities"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex text-xs font-semibold text-brand-blue underline underline-offset-2"
                >
                  Open Green Button Utilities Directory
                </a>
              </div>

              <div className="border-t border-brand-navy/10 pt-3">
                <p className="font-semibold text-brand-navy">
                  Examples of utilities with Green Button
                </p>
                <p className="text-brand-slate">
                  Many large utilities already provide Green Button, including:
                </p>
                <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px] text-brand-slate">
                  <li>Pacific Gas &amp; Electric (PG&amp;E)</li>
                  <li>San Diego Gas &amp; Electric (SDG&amp;E)</li>
                  <li>Southern California Edison (SCE)</li>
                  <li>Alectra Utilities (Canada)</li>
                  <li>Louisville Gas &amp; Electric / KU (LGE/KU)</li>
                </ul>
                <p className="mt-1 text-[11px] text-brand-slate">
                  This is only a partial list. Use the official directory above to search for your
                  utility or co-op.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

