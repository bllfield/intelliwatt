"use client";

import React, { useState, FormEvent, useEffect } from "react";

type RateType = "FIXED" | "VARIABLE" | "TIME_OF_USE";

type VariableRateIndexType = "ERCOT" | "FUEL" | "OTHER";

type DayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

type BillCreditRule = {
  label: string;
  creditAmountCents: number;
  minUsageKWh: number;
  maxUsageKWh?: number;
  monthsOfYear?: number[];
};

type BillCreditStructure = {
  hasBillCredit: boolean;
  rules: BillCreditRule[];
};

type TimeOfUseTier = {
  label: string;
  priceCents: number;
  startTime: string;
  endTime: string;
  daysOfWeek: DayCode[] | "ALL";
  monthsOfYear?: number[];
};

type BaseRateStructure = {
  type: RateType;
  baseMonthlyFeeCents?: number;
  billCredits?: BillCreditStructure | null;
};

type FixedRateStructure = BaseRateStructure & {
  type: "FIXED";
  energyRateCents: number;
};

type VariableRateStructure = BaseRateStructure & {
  type: "VARIABLE";
  currentBillEnergyRateCents: number;
  indexType?: VariableRateIndexType;
  variableNotes?: string;
};

type TimeOfUseRateStructure = BaseRateStructure & {
  type: "TIME_OF_USE";
  tiers: TimeOfUseTier[];
};

type RateStructure = FixedRateStructure | VariableRateStructure | TimeOfUseRateStructure;

type ManualEntryPayload = {
  providerName: string;
  planName: string;
  rateType: RateType;
  rateStructure: RateStructure;
  energyRateCents?: number | null;
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
  { value: "VARIABLE", label: "Variable / indexed rate" },
  { value: "TIME_OF_USE", label: "Time-of-use (different rates by time of day)" },
];

const VARIABLE_INDEX_OPTIONS: Array<{ value: VariableRateIndexType; label: string }> = [
  { value: "ERCOT", label: "ERCOT market index" },
  { value: "FUEL", label: "Fuel / commodity index" },
  { value: "OTHER", label: "Other index" },
];

const DAY_OPTIONS: Array<{ value: DayCode; label: string }> = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];

const MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

type TimeOfUseTierForm = {
  id: string;
  label: string;
  priceCents: string;
  startTime: string;
  endTime: string;
  useAllDays: boolean;
  selectedDays: DayCode[];
  selectedMonths: number[];
};

const createEmptyTier = (): TimeOfUseTierForm => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  label: "",
  priceCents: "",
  startTime: "",
  endTime: "",
  useAllDays: true,
  selectedDays: [],
  selectedMonths: [],
});

type BillCreditRuleForm = {
  id: string;
  label: string;
  creditAmount: string;
  minUsage: string;
  maxUsage: string;
  applyAllMonths: boolean;
  selectedMonths: number[];
};

const createEmptyBillCreditRule = (): BillCreditRuleForm => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  label: "",
  creditAmount: "",
  minUsage: "",
  maxUsage: "",
  applyAllMonths: true,
  selectedMonths: [],
});

export function CurrentRateDetailsForm({
  onContinue,
  onSkip,
}: CurrentRateDetailsFormProps) {
  const [electricCompany, setElectricCompany] = useState("");
  const [planName, setPlanName] = useState("");
  const [rateType, setRateType] = useState<RateType>("FIXED");
  const [primaryRateCentsPerKwh, setPrimaryRateCentsPerKwh] = useState("");
  const [baseFeeDollars, setBaseFeeDollars] = useState("");
  const [variableIndexType, setVariableIndexType] = useState<VariableRateIndexType | "">("");
  const [variableNotes, setVariableNotes] = useState("");
  const [touTiers, setTouTiers] = useState<TimeOfUseTierForm[]>([createEmptyTier()]);
  const [includeBillCredits, setIncludeBillCredits] = useState(false);
  const [billCreditRules, setBillCreditRules] = useState<BillCreditRuleForm[]>([createEmptyBillCreditRule()]);
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

  useEffect(() => {
    if (rateType !== "VARIABLE") {
      setVariableIndexType("");
      setVariableNotes("");
    }
  }, [rateType]);

  useEffect(() => {
    if (rateType === "TIME_OF_USE" && touTiers.length === 0) {
      setTouTiers([createEmptyTier()]);
    }
  }, [rateType, touTiers.length]);

  useEffect(() => {
    if (includeBillCredits && billCreditRules.length === 0) {
      setBillCreditRules([createEmptyBillCreditRule()]);
    }
  }, [includeBillCredits, billCreditRules.length]);

  const updateTier = (id: string, updater: (tier: TimeOfUseTierForm) => TimeOfUseTierForm) => {
    setTouTiers((tiers) => tiers.map((tier) => (tier.id === id ? updater(tier) : tier)));
  };

  const handleAddTier = () => {
    setTouTiers((tiers) => [...tiers, createEmptyTier()]);
  };

  const handleRemoveTier = (id: string) => {
    setTouTiers((tiers) => (tiers.length <= 1 ? tiers : tiers.filter((tier) => tier.id !== id)));
  };

  const toggleTierDay = (id: string, day: DayCode) => {
    updateTier(id, (tier) => {
      if (tier.useAllDays) {
        return tier;
      }
      const exists = tier.selectedDays.includes(day);
      const nextDays = exists
        ? tier.selectedDays.filter((d) => d !== day)
        : [...tier.selectedDays, day];
      return {
        ...tier,
        selectedDays: nextDays.sort(
          (a, b) => DAY_OPTIONS.findIndex((opt) => opt.value === a) - DAY_OPTIONS.findIndex((opt) => opt.value === b),
        ),
      };
    });
  };

  const toggleTierMonth = (id: string, month: number) => {
    updateTier(id, (tier) => {
      const exists = tier.selectedMonths.includes(month);
      const nextMonths = exists
        ? tier.selectedMonths.filter((m) => m !== month)
        : [...tier.selectedMonths, month];
      return {
        ...tier,
        selectedMonths: nextMonths.sort((a, b) => a - b),
      };
    });
  };

  const updateBillCreditRule = (id: string, updater: (rule: BillCreditRuleForm) => BillCreditRuleForm) => {
    setBillCreditRules((rules) => rules.map((rule) => (rule.id === id ? updater(rule) : rule)));
  };

  const handleAddBillCreditRule = () => {
    setBillCreditRules((rules) => [...rules, createEmptyBillCreditRule()]);
  };

  const handleRemoveBillCreditRule = (id: string) => {
    setBillCreditRules((rules) => (rules.length <= 1 ? rules : rules.filter((rule) => rule.id !== id)));
  };

  const toggleBillCreditMonth = (id: string, month: number) => {
    updateBillCreditRule(id, (rule) => {
      if (rule.applyAllMonths) {
        return rule;
      }
      const exists = rule.selectedMonths.includes(month);
      const nextMonths = exists ? rule.selectedMonths.filter((m) => m !== month) : [...rule.selectedMonths, month];
      return {
        ...rule,
        selectedMonths: nextMonths.sort((a, b) => a - b),
      };
    });
  };

  const parseNumber = (value: string) => {
    if (!value || value.trim().length === 0) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const toMonthlyFeeCents = (value: number | null) => {
    if (value === null || Number.isNaN(value)) {
      return undefined;
    }
    return Math.round(value * 100);
  };

  const isValidTime = (value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) {
      return false;
    }
    const [hoursStr, minutesStr] = value.split(":");
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    return Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
  };

  const withCentsPrecision = (value: number | null) => {
    if (value === null) {
      return null;
    }
    return Number(value.toFixed(4));
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
    if (baseFeeDollars.trim().length > 0 && (baseCharge === null || baseCharge < 0)) {
      validationErrors.push("Base charge must be zero or a positive number.");
    }
    if (termLengthMonths.trim().length > 0) {
      if (termLength === null || termLength <= 0 || !Number.isInteger(termLength)) {
        validationErrors.push("Term length must be a whole number of months greater than zero.");
      }
    }
    let billCreditsStructure: BillCreditStructure = { hasBillCredit: false, rules: [] };
    if (includeBillCredits) {
      const sanitizedRules: BillCreditRule[] = [];
      billCreditRules.forEach((rule, index) => {
        const label = rule.label.trim();
        if (!label) {
          validationErrors.push(`Bill credit ${index + 1}: Enter a label (e.g., $100 credit at 1000–2000 kWh).`);
        }

        const creditAmountValue = parseNumber(rule.creditAmount);
        if (creditAmountValue === null || creditAmountValue <= 0) {
          validationErrors.push(`Bill credit ${index + 1}: Credit amount must be a positive number.`);
        }

        const minUsageValue = parseNumber(rule.minUsage);
        if (minUsageValue === null || minUsageValue < 0) {
          validationErrors.push(`Bill credit ${index + 1}: Minimum usage must be zero or greater.`);
        }

        const maxUsageValueRaw = parseNumber(rule.maxUsage);
        let maxUsageValue: number | undefined;
        if (maxUsageValueRaw !== null) {
          if (maxUsageValueRaw < 0) {
            validationErrors.push(`Bill credit ${index + 1}: Maximum usage must be zero or greater.`);
          } else if (minUsageValue !== null && maxUsageValueRaw < minUsageValue) {
            validationErrors.push(`Bill credit ${index + 1}: Maximum usage must be greater than or equal to minimum usage.`);
          } else {
            maxUsageValue = maxUsageValueRaw;
          }
        }

        if (
          label &&
          creditAmountValue !== null &&
          creditAmountValue > 0 &&
          minUsageValue !== null &&
          minUsageValue >= 0
        ) {
        if (!rule.applyAllMonths && rule.selectedMonths.length === 0) {
          validationErrors.push(`Bill credit ${index + 1}: Select at least one month or enable "Applies all months."`);
        }

        const monthsOfYear =
          rule.applyAllMonths || rule.selectedMonths.length === 0
            ? undefined
            : [...rule.selectedMonths].sort((a, b) => a - b);

          sanitizedRules.push({
            label,
            creditAmountCents: Math.round(creditAmountValue * 100),
            minUsageKWh: minUsageValue,
            ...(typeof maxUsageValue === "number" ? { maxUsageKWh: maxUsageValue } : {}),
            ...(monthsOfYear ? { monthsOfYear } : {}),
          });
        }
      });

      if (sanitizedRules.length === 0) {
        validationErrors.push("Add at least one bill credit rule or turn off bill credits.");
      } else {
        billCreditsStructure = {
          hasBillCredit: true,
          rules: sanitizedRules,
        };
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

    let energyRateForPayload: number | null = null;
    let rateStructure: RateStructure | null = null;

    if (rateType === "FIXED") {
      const fixedRate = parseNumber(primaryRateCentsPerKwh);
      if (fixedRate === null || fixedRate <= 0) {
        validationErrors.push("Energy rate must be a positive number.");
      } else {
        energyRateForPayload = fixedRate;
        const baseMonthlyFeeCents = toMonthlyFeeCents(baseCharge);
        rateStructure = {
          type: "FIXED",
          energyRateCents: withCentsPrecision(fixedRate) ?? fixedRate,
          ...(baseMonthlyFeeCents !== undefined ? { baseMonthlyFeeCents } : {}),
          billCredits: billCreditsStructure,
        };
      }
    } else if (rateType === "VARIABLE") {
      const variableRate = parseNumber(primaryRateCentsPerKwh);
      if (variableRate === null || variableRate <= 0) {
        validationErrors.push("Current bill energy rate must be a positive number.");
      } else {
        energyRateForPayload = variableRate;
      }
      const baseMonthlyFeeCents = toMonthlyFeeCents(baseCharge);
      const trimmedVariableNotes = variableNotes.trim();
      if (variableRate !== null && variableRate > 0) {
        rateStructure = {
          type: "VARIABLE",
          currentBillEnergyRateCents: withCentsPrecision(variableRate) ?? variableRate,
          ...(baseMonthlyFeeCents !== undefined ? { baseMonthlyFeeCents } : {}),
          billCredits: billCreditsStructure,
          ...(variableIndexType ? { indexType: variableIndexType } : {}),
          ...(trimmedVariableNotes ? { variableNotes: trimmedVariableNotes } : {}),
        };
      }
    } else if (rateType === "TIME_OF_USE") {
      const sanitizedTiers: TimeOfUseTier[] = [];

      touTiers.forEach((tier, index) => {
        const label = tier.label.trim();
        if (!label) {
          validationErrors.push(`Tier ${index + 1}: Enter a label (e.g., Peak, Off-Peak).`);
        }

        const price = parseNumber(tier.priceCents);
        if (price === null || price < 0) {
          validationErrors.push(`Tier ${index + 1}: Price must be zero or a positive number.`);
        }

        if (!tier.startTime || !isValidTime(tier.startTime)) {
          validationErrors.push(`Tier ${index + 1}: Start time must use 24-hour HH:MM (e.g., 21:00).`);
        }
        if (!tier.endTime || !isValidTime(tier.endTime)) {
          validationErrors.push(`Tier ${index + 1}: End time must use 24-hour HH:MM (e.g., 06:00).`);
        }

        if (!tier.useAllDays && tier.selectedDays.length === 0) {
          validationErrors.push(`Tier ${index + 1}: Select at least one day or choose All days.`);
        }

        const invalidMonth = tier.selectedMonths.some((month) => month < 1 || month > 12);
        if (invalidMonth) {
          validationErrors.push(`Tier ${index + 1}: Months must be between 1 and 12.`);
        }

        if (
          label &&
          price !== null &&
          price >= 0 &&
          tier.startTime &&
          isValidTime(tier.startTime) &&
          tier.endTime &&
          isValidTime(tier.endTime) &&
          (tier.useAllDays || tier.selectedDays.length > 0) &&
          !invalidMonth
        ) {
          const daysOfWeek: DayCode[] | "ALL" = tier.useAllDays
            ? "ALL"
            : [...tier.selectedDays].sort(
                (a, b) => DAY_OPTIONS.findIndex((opt) => opt.value === a) - DAY_OPTIONS.findIndex((opt) => opt.value === b),
              );

          const monthsOfYear =
            tier.selectedMonths.length > 0 ? [...tier.selectedMonths].sort((a, b) => a - b) : undefined;

          sanitizedTiers.push({
            label,
            priceCents: withCentsPrecision(price) ?? price,
            startTime: tier.startTime,
            endTime: tier.endTime,
            daysOfWeek,
            ...(monthsOfYear ? { monthsOfYear } : {}),
          });
        }
      });

      if (sanitizedTiers.length === 0) {
        validationErrors.push("Add at least one time-of-use tier with pricing, times, and day coverage.");
      }

      const baseMonthlyFeeCents = toMonthlyFeeCents(baseCharge);
      if (sanitizedTiers.length > 0) {
        rateStructure = {
          type: "TIME_OF_USE",
          tiers: sanitizedTiers,
          ...(baseMonthlyFeeCents !== undefined ? { baseMonthlyFeeCents } : {}),
          billCredits: billCreditsStructure,
        };
      }
      energyRateForPayload = null;
    }

    if (!rateStructure) {
      validationErrors.push("Provide rate details for the selected plan type.");
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
      rateStructure: rateStructure!,
      energyRateCents: energyRateForPayload,
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

          {rateType !== "TIME_OF_USE" ? (
            <label className="block space-y-1 text-sm text-brand-navy">
              <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
                {rateType === "VARIABLE" ? "Current bill energy rate (¢/kWh)" : "Flat energy rate (¢/kWh)"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={primaryRateCentsPerKwh}
                onChange={(e) => setPrimaryRateCentsPerKwh(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                placeholder={rateType === "VARIABLE" ? "e.g., 14.5" : "e.g., 13.9"}
              />
            </label>
          ) : null}

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Base monthly fee ($/month, optional)
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={baseFeeDollars}
              onChange={(e) => setBaseFeeDollars(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 4.95"
            />
          </label>

          <div className="space-y-3 rounded-2xl border border-brand-blue/30 bg-brand-blue/5 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-navy/80">
              <input
                type="checkbox"
                checked={includeBillCredits}
                onChange={(e) => setIncludeBillCredits(e.target.checked)}
                className="h-4 w-4 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
              />
              <span>Bill credits (if applicable)</span>
            </label>

            {includeBillCredits
              ? billCreditRules.map((rule, index) => (
                  <div
                    key={rule.id}
                    className="space-y-3 rounded-2xl border border-brand-blue/30 bg-white p-4 shadow-sm transition"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-navy/90">
                        Bill Credit {index + 1}
                      </h3>
                      {billCreditRules.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveBillCreditRule(rule.id)}
                          className="text-xs font-semibold uppercase tracking-wide text-rose-600 transition hover:text-rose-700"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <label className="block space-y-1 text-sm text-brand-navy">
                      <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Credit label</span>
                      <input
                        type="text"
                        value={rule.label}
                        onChange={(e) =>
                          updateBillCreditRule(rule.id, (prev) => ({
                            ...prev,
                            label: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                        placeholder="e.g., $100 credit at 1000–2000 kWh"
                      />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block space-y-1 text-sm text-brand-navy">
                        <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Credit amount ($)</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={rule.creditAmount}
                          onChange={(e) =>
                            updateBillCreditRule(rule.id, (prev) => ({
                              ...prev,
                              creditAmount: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                          placeholder="e.g., 100"
                        />
                      </label>

                      <label className="block space-y-1 text-sm text-brand-navy">
                        <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
                          Minimum usage (kWh)
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={rule.minUsage}
                          onChange={(e) =>
                            updateBillCreditRule(rule.id, (prev) => ({
                              ...prev,
                              minUsage: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                          placeholder="e.g., 1000"
                        />
                      </label>

                      <label className="block space-y-1 text-sm text-brand-navy">
                        <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
                          Maximum usage (kWh, optional)
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={rule.maxUsage}
                          onChange={(e) =>
                            updateBillCreditRule(rule.id, (prev) => ({
                              ...prev,
                              maxUsage: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                          placeholder="Leave blank if no upper limit"
                        />
                      </label>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-navy/80">
                        <input
                          type="checkbox"
                          checked={rule.applyAllMonths}
                          onChange={() =>
                            updateBillCreditRule(rule.id, (prev) => ({
                              ...prev,
                              applyAllMonths: !prev.applyAllMonths,
                              selectedMonths:
                            prev.applyAllMonths === false ? prev.selectedMonths : [],
                            }))
                          }
                          className="h-4 w-4 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                        />
                        <span>Applies all months</span>
                      </label>

                      {!rule.applyAllMonths ? (
                        <div className="flex flex-wrap gap-2">
                          {MONTH_OPTIONS.map((month) => (
                            <label
                              key={`${rule.id}-month-${month.value}`}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                                rule.selectedMonths.includes(month.value)
                                  ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                                  : "border-slate-300 text-brand-slate"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                                checked={rule.selectedMonths.includes(month.value)}
                                onChange={() => toggleBillCreditMonth(rule.id, month.value)}
                              />
                              {month.label}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              : null}

            {includeBillCredits ? (
              <button
                type="button"
                onClick={handleAddBillCreditRule}
                className="inline-flex items-center rounded-full border border-brand-blue px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:bg-brand-blue/10"
              >
                + Add another bill credit
              </button>
            ) : null}
          </div>

          {rateType === "VARIABLE" ? (
            <>
              <label className="block space-y-1 text-sm text-brand-navy">
                <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Index type</span>
                <select
                  value={variableIndexType}
                  onChange={(e) => setVariableIndexType(e.target.value as VariableRateIndexType | "")}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                >
                  <option value="">Select index type</option>
                  {VARIABLE_INDEX_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-sm text-brand-navy">
                <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
                  Index notes (optional)
                </span>
                <textarea
                  value={variableNotes}
                  onChange={(e) => setVariableNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                  placeholder="e.g., Rate resets monthly based on ERCOT balancing market."
                />
              </label>
            </>
          ) : null}

          {rateType === "TIME_OF_USE" ? (
            <div className="space-y-4 rounded-2xl border border-brand-blue/30 bg-brand-blue/5 p-4">
              <p className="text-sm text-brand-navy">
                Define each time-of-use tier below. Add blocks for free nights, peak hours, weekends, or seasonal pricing.
              </p>

              {touTiers.map((tier, index) => (
                <div
                  key={tier.id}
                  className="space-y-3 rounded-2xl border border-brand-blue/30 bg-white p-4 shadow-sm transition"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-navy/90">
                      Tier {index + 1}
                    </h3>
                    {touTiers.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveTier(tier.id)}
                        className="text-xs font-semibold uppercase tracking-wide text-rose-600 transition hover:text-rose-700"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <label className="block space-y-1 text-sm text-brand-navy">
                    <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Tier label</span>
                    <input
                      type="text"
                      value={tier.label}
                      onChange={(e) =>
                        updateTier(tier.id, (prev) => ({
                          ...prev,
                          label: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                      placeholder="e.g., Free Nights, Peak, Off-Peak"
                    />
                  </label>

                  <label className="block space-y-1 text-sm text-brand-navy">
                    <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Price (¢/kWh)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={tier.priceCents}
                      onChange={(e) =>
                        updateTier(tier.id, (prev) => ({
                          ...prev,
                          priceCents: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                      placeholder="e.g., 0 or 18.5"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1 text-sm text-brand-navy">
                      <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Start time</span>
                      <input
                        type="time"
                        value={tier.startTime}
                        onChange={(e) =>
                          updateTier(tier.id, (prev) => ({
                            ...prev,
                            startTime: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                      />
                    </label>
                    <label className="block space-y-1 text-sm text-brand-navy">
                      <span className="font-semibold uppercase tracking-wide text-brand-navy/80">End time</span>
                      <input
                        type="time"
                        value={tier.endTime}
                        onChange={(e) =>
                          updateTier(tier.id, (prev) => ({
                            ...prev,
                            endTime: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-navy/80">
                      <input
                        type="checkbox"
                        checked={tier.useAllDays}
                        onChange={() =>
                          updateTier(tier.id, (prev) => ({
                            ...prev,
                            useAllDays: !prev.useAllDays,
                            selectedDays:
                              prev.useAllDays === false
                                ? prev.selectedDays
                                : prev.selectedDays.length > 0
                                ? prev.selectedDays
                                : ["MON"],
                          }))
                        }
                        className="h-4 w-4 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                      />
                      <span>Apply every day</span>
                    </label>
                    {!tier.useAllDays ? (
                      <div className="flex flex-wrap gap-2">
                        {DAY_OPTIONS.map((day) => (
                          <label
                            key={`${tier.id}-${day.value}`}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                              tier.selectedDays.includes(day.value)
                                ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                                : "border-slate-300 text-brand-slate"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                              checked={tier.selectedDays.includes(day.value)}
                              onChange={() => toggleTierDay(tier.id, day.value)}
                            />
                            {day.label}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-navy/80">
                      Months (optional)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {MONTH_OPTIONS.map((month) => (
                        <label
                          key={`${tier.id}-month-${month.value}`}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                            tier.selectedMonths.includes(month.value)
                              ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                              : "border-slate-300 text-brand-slate"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-3 w-3 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                            checked={tier.selectedMonths.includes(month.value)}
                            onChange={() => toggleTierMonth(tier.id, month.value)}
                          />
                          {month.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddTier}
                className="inline-flex items-center rounded-full border border-brand-blue px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:bg-brand-blue/10"
              >
                + Add another time-of-use tier
              </button>
            </div>
          ) : null}

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

