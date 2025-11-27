"use client";

import React, { useState, FormEvent, useEffect } from "react";

type RateType = "FIXED" | "VARIABLE" | "TIME_OF_USE" | "OTHER";

type ManualEntryPayload = {
  providerName: string;
  planName: string;
  rateType: RateType;
  energyRateCents: number;
  baseMonthlyFee?: number | null;
  termLengthMonths?: number | null;
  contractEndDate?: string | null;
  earlyTerminationFee?: number | null;
  esiId?: string | null;
  accountNumberLast4?: string | null;
  notes?: string | null;
  billUploaded?: boolean;
};

type CurrentRateDetailsFormProps = {
  onContinue?: (data: ManualEntryPayload) => void;
  onSkip?: () => void;
};

const RATE_TYPE_OPTIONS: Array<{ value: RateType; label: string }> = [
  { value: "FIXED", label: "Fixed rate" },
  { value: "VARIABLE", label: "Variable rate" },
  { value: "TIME_OF_USE", label: "Time-of-use" },
  { value: "OTHER", label: "Other / not sure" },
];

export function CurrentRateDetailsForm({
  onContinue,
  onSkip,
}: CurrentRateDetailsFormProps) {
  const [electricCompany, setElectricCompany] = useState("");
  const [planName, setPlanName] = useState("");
  const [rateType, setRateType] = useState<RateType>("FIXED");
  const [primaryRateCentsPerKwh, setPrimaryRateCentsPerKwh] = useState("");
  const [baseFeeDollars, setBaseFeeDollars] = useState("");
  const [termLengthMonths, setTermLengthMonths] = useState("");
  const [earlyTerminationFee, setEarlyTerminationFee] = useState("");
  const [contractExpiration, setContractExpiration] = useState("");
  const [esiId, setEsiId] = useState("");
  const [accountNumberLast4, setAccountNumberLast4] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [billUploaded, setBillUploaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [hasAwarded, setHasAwarded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("intelliwatt_current_plan_details_complete");
      if (stored === "true") {
        setHasAwarded(true);
      }
    }
  }, []);

  const parseNumber = (value: string) => {
    if (!value || value.trim().length === 0) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  async function uploadBill(options: { silent?: boolean } = {}): Promise<boolean> {
    const { silent = false } = options;

    if (!file) {
      if (!silent) {
        setUploadStatus("Select a bill before uploading.");
      }
      return false;
    }

    try {
      setIsUploading(true);
      if (!silent) {
        setUploadStatus(null);
      }

      const formData = new FormData();
      formData.append("billFile", file);

      const response = await fetch("/api/current-plan/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data?.error ?? "We couldn't upload your bill right now. Please try again.";
        if (!silent) {
          setUploadStatus(message);
        }
        return false;
      }

      const entryAwarded = Boolean(data?.entryAwarded);
      const alreadyAwarded = Boolean(data?.alreadyAwarded);
      if (entryAwarded || alreadyAwarded) {
        setHasAwarded(true);
        if (typeof window !== "undefined") {
          localStorage.setItem("intelliwatt_current_plan_details_complete", "true");
          window.dispatchEvent(new CustomEvent("entriesUpdated"));
        }
      }

      setBillUploaded(true);
      if (!silent) {
        const message = entryAwarded
          ? "✓ Bill uploaded and bonus entry recorded."
          : alreadyAwarded
          ? "Bill uploaded. You've already earned the current plan entry."
          : "✓ Bill uploaded and saved securely.";
        setUploadStatus(message);
      }
      return true;
    } catch (error) {
      if (!silent) {
        setUploadStatus("Upload failed. Please try again.");
      }
      return false;
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);

    const validationErrors: string[] = [];
    const providerName = electricCompany.trim();
    const currentPlanName = planName.trim();
    const energyRate = parseNumber(primaryRateCentsPerKwh);
    const baseCharge = parseNumber(baseFeeDollars);
    const termLength = parseNumber(termLengthMonths);
    const earlyTermination = parseNumber(earlyTerminationFee);
    const contractDate = contractExpiration.trim().length > 0 ? new Date(contractExpiration) : null;
    const formattedNotes = notes.trim().length > 0 ? notes.trim() : null;
    const esiIdValue = esiId.trim().length > 0 ? esiId.trim() : null;
    const accountLast4Value =
      accountNumberLast4.trim().length > 0 ? accountNumberLast4.trim() : null;

    if (!providerName) {
      validationErrors.push("Enter the name of your electric company.");
    }
    if (!currentPlanName) {
      validationErrors.push("Enter your plan name.");
    }
    if (energyRate === null || energyRate <= 0) {
      validationErrors.push("Energy rate must be a positive number.");
    }
    if (baseFeeDollars.trim().length > 0 && (baseCharge === null || baseCharge < 0)) {
      validationErrors.push("Base charge must be zero or a positive number.");
    }
    if (termLengthMonths.trim().length > 0) {
      if (termLength === null || termLength <= 0 || !Number.isInteger(termLength)) {
        validationErrors.push("Term length must be a whole number of months greater than zero.");
      }
    }
    if (earlyTerminationFee.trim().length > 0) {
      if (earlyTermination === null || earlyTermination < 0) {
        validationErrors.push("Early termination fee must be zero or a positive number.");
      }
    }
    if (contractDate && Number.isNaN(contractDate.getTime())) {
      validationErrors.push("Contract expiration date must be a valid date.");
    }
    if (accountLast4Value && accountLast4Value.length > 8) {
      validationErrors.push("Account number (last digits) must be 8 characters or fewer.");
    }

    if (validationErrors.length > 0) {
      setStatusMessage(validationErrors.join(" "));
      setHasAwarded(false);
      setIsSubmitting(false);
      return;
    }

    const manualPayload: ManualEntryPayload = {
      providerName,
      planName: currentPlanName,
      rateType,
      energyRateCents: energyRate ?? 0,
      baseMonthlyFee: baseCharge ?? null,
      termLengthMonths:
        termLengthMonths.trim().length > 0 ? Number(Math.round(termLength ?? 0)) : null,
      contractEndDate: contractDate ? contractDate.toISOString() : null,
      earlyTerminationFee: earlyTermination ?? null,
      esiId: esiIdValue,
      accountNumberLast4: accountLast4Value,
      notes: formattedNotes,
      billUploaded,
    };

    try {
      const response = await fetch("/api/current-plan/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualPayload),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const details = Array.isArray(data?.details) ? data.details.join(" ") : data?.error;
        throw new Error(details ?? "Unable to save your current plan details right now.");
      }

      const entryAwarded = Boolean(data?.entryAwarded);
      const alreadyAwarded = Boolean(data?.alreadyAwarded);
      if (entryAwarded || alreadyAwarded) {
        setHasAwarded(true);
        if (typeof window !== "undefined") {
          localStorage.setItem("intelliwatt_current_plan_details_complete", "true");
          window.dispatchEvent(new CustomEvent("entriesUpdated"));
        }
      }

      if (file && !billUploaded) {
        const uploaded = await uploadBill({ silent: true });
        manualPayload.billUploaded = uploaded;
        if (!uploaded) {
          setStatusMessage(
            "We saved your manual plan details, but the bill upload failed. Try uploading the file again below.",
          );
          onContinue?.(manualPayload);
          return;
        }
      }

      const baseMessage = entryAwarded
        ? "✓ Entry added! Your current plan details are now counted toward the jackpot."
        : alreadyAwarded
        ? "You've already earned an entry for sharing your current plan details."
        : "Current plan details saved.";

      const finalMessage = manualPayload.billUploaded
        ? `${baseMessage} Bill uploaded and ready for parsing.`
        : baseMessage;

      setStatusMessage(finalMessage);
      onContinue?.(manualPayload);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save current plan details right now.";
      setHasAwarded(false);
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border-2 border-brand-navy bg-brand-navy p-6 text-brand-cyan shadow-[0_28px_60px_rgba(16,46,90,0.38)] sm:p-7">
        <h2
          className="text-xs font-semibold uppercase tracking-[0.3em]"
          style={{ color: "#39FF14" }}
        >
          Optional · +1 HitTheJackWatt™ Entry
        </h2>
        <p className="mt-3 text-base font-semibold text-brand-cyan">
          Capture today&apos;s plan so renewal pricing lines up with IntelliWatt recommendations.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-brand-cyan/85">
          Upload a recent bill or enter your contract details manually.
          Completing this step earns an extra jackpot entry and unlocks richer savings comparisons.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr,1.05fr]">
        <div className="space-y-4 rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-sm sm:p-7">
          <h2 className="text-base font-semibold text-brand-navy">Option 1 · Upload your latest bill</h2>
          <p className="text-sm text-brand-slate">
            On mobile, snap a clear photo. On desktop, upload the PDF. We&apos;ll parse it soon to auto-fill your plan data.
          </p>
          <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-6 text-center text-sm text-brand-navy transition hover:border-brand-blue/60 hover:bg-brand-blue/10">
            <span className="font-semibold">Drag your file here or click to browse</span>
            <span className="mt-1 text-xs text-brand-slate">Accepted formats: PDF, JPG, PNG</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setBillUploaded(false);
                setUploadStatus(null);
              }}
              className="hidden"
            />
          </label>
          {file ? (
            <p className="rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-2 text-xs text-brand-navy">
              Selected file: <span className="font-semibold">{file.name}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => uploadBill()}
            disabled={!file || isUploading}
            className="inline-flex items-center rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_24px_rgba(16,46,90,0.25)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Uploading…" : billUploaded ? "Bill Uploaded ✓" : "Upload bill now"}
          </button>
          {uploadStatus ? (
            <p
              className={`text-sm ${
                billUploaded ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {uploadStatus}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-sm sm:p-7"
        >
          <h2 className="text-base font-semibold text-brand-navy">Option 2 · Enter plan details manually</h2>
          <p className="text-sm text-brand-slate">
            Most bills list these near the header or inside the Electricity Facts Label (EFL) section.
          </p>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Electric company name</span>
            <input
              type="text"
              value={electricCompany}
              onChange={(e) => setElectricCompany(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., Sample Energy Co."
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Plan name</span>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., Free Nights & Solar Days 12"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Rate type</span>
            <select
              value={rateType}
              onChange={(e) => setRateType(e.target.value as RateType)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
            >
              {RATE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Energy rate (¢/kWh)</span>
            <input
              type="number"
              inputMode="decimal"
              value={primaryRateCentsPerKwh}
              onChange={(e) => setPrimaryRateCentsPerKwh(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 13.9"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Base charge ($/month)</span>
            <input
              type="number"
              inputMode="decimal"
              value={baseFeeDollars}
              onChange={(e) => setBaseFeeDollars(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 4.95"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Term length (months)</span>
            <input
              type="number"
              inputMode="numeric"
              value={termLengthMonths}
              onChange={(e) => setTermLengthMonths(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 12"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Contract expiration date</span>
            <input
              type="date"
              value={contractExpiration}
              onChange={(e) => setContractExpiration(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Early termination fee ($)</span>
            <input
              type="number"
              inputMode="decimal"
              value={earlyTerminationFee}
              onChange={(e) => setEarlyTerminationFee(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 150"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">ESIID (optional)</span>
            <input
              type="text"
              value={esiId}
              onChange={(e) => setEsiId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="17- or 22-digit ID from your bill"
            />
          </label>

  <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Account number (last digits)</span>
            <input
              type="text"
              value={accountNumberLast4}
              onChange={(e) => setAccountNumberLast4(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="Last 4–8 digits"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="Free nights/weekends, tiered pricing, bill credits, etc."
              rows={4}
            />
          </label>

          <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_24px_rgba(16,46,90,0.25)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Saving..." : hasAwarded ? "Update current plan" : "Finish current rate details"}
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="text-sm font-semibold text-brand-blue underline decoration-dashed underline-offset-4 transition hover:text-brand-blue/80"
              >
                Skip for now
              </button>
            </div>
            <p className="text-xs text-brand-slate">
              Your responses stay private—we only use them to compare renewal costs to IntelliWatt savings.
            </p>
          </div>
        </form>
      </div>

      {statusMessage ? (
        <div
          className={`rounded-2xl border px-5 py-4 text-sm shadow-sm ${
            hasAwarded
              ? "border-emerald-400/40 bg-emerald-50 text-emerald-700"
              : "border-rose-400/40 bg-rose-50 text-rose-700"
          }`}
        >
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}

