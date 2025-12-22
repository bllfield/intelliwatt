"use client";

import React, {
  useState,
  FormEvent,
  useEffect,
  useCallback,
  useRef,
} from "react";
import LocalTime from "@/components/LocalTime";
import Link from "next/link";

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
  tdspDeliveryIncludedInEnergyCharge?: boolean | null;
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

type EntrySnapshot = {
  id: string;
  status: string;
  expiresAt: string | null;
  lastValidated: string | null;
  updatedAt: string;
  amount?: number;
  houseId?: string | null;
};

type SavedPlanDetails = {
  id: string;
  userId: string;
  houseId: string | null;
  providerName: string;
  planName: string;
  rateType: string;
  energyRateCents: number | null;
  baseMonthlyFee: number | null;
  billCreditDollars: number | null;
  termLengthMonths: number | null;
  contractEndDate: string | null;
  earlyTerminationFee: number | null;
  esiId: string | null;
  accountNumberLast4: string | null;
  notes: string | null;
  rateStructure: any;
  normalizedAt: string | null;
  lastConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ParsedPlanDetails = {
  id: string;
  userId: string;
  houseId: string;
  providerName: string | null;
  planName: string | null;
  rateType: string | null;
  energyRateCents: number | null;
  baseMonthlyFee: number | null;
  billCreditDollars: number | null;
  termLengthMonths: number | null;
  contractEndDate: string | null;
  earlyTerminationFee: number | null;
  esiId: string | null;
  accountNumberLast4: string | null;
  notes: string | null;
  rateStructure: any;
  parserVersion?: string | null;
  confidenceScore?: number | null;
  createdAt: string;
  updatedAt: string;
};

type PlanVariablesUsed = {
  rep: {
    energyCentsPerKwh: number | null;
    fixedMonthlyChargeDollars: number | null;
  };
  tdsp:
    | {
        perKwhDeliveryChargeCents: number | null;
        monthlyCustomerChargeDollars: number | null;
        effectiveDate: string | null;
      }
    | null;
};

type VariablesListRow = { key: string; label: string; value: string };

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
  const [savedPlan, setSavedPlan] = useState<SavedPlanDetails | null>(null);
  const [parsedPlan, setParsedPlan] = useState<ParsedPlanDetails | null>(null);
  const [planVariablesUsed, setPlanVariablesUsed] = useState<PlanVariablesUsed | null>(null);
  const [planVariablesList, setPlanVariablesList] = useState<VariablesListRow[] | null>(null);
  const [planEntrySnapshot, setPlanEntrySnapshot] = useState<EntrySnapshot | null>(null);
  const [usageSnapshot, setUsageSnapshot] = useState<EntrySnapshot | null>(null);
  const [hasActiveUsage, setHasActiveUsage] = useState(false);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(true);
  const [savedPlanError, setSavedPlanError] = useState<string | null>(null);
  const [reconfirming, setReconfirming] = useState(false);
  const [reconfirmMessage, setReconfirmMessage] = useState<string | null>(null);
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
  const [files, setFiles] = useState<File[]>([]);
  const [billUploaded, setBillUploaded] = useState(false);
  const [eflFile, setEflFile] = useState<File | null>(null);
  const [isParsingEfl, setIsParsingEfl] = useState(false);
  const [eflParseStatus, setEflParseStatus] = useState<string | null>(null);
  const [prefilledFromEfl, setPrefilledFromEfl] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [hasAwarded, setHasAwarded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedBillText, setPastedBillText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [deliveryIncluded, setDeliveryIncluded] = useState<boolean | null>(null);
  const [isParsingPaste, setIsParsingPaste] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const isMountedRef = useRef(true);
  const hasInitializedFromPlanRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshPlan = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }
    setLoadingSavedPlan(true);
    setSavedPlanError(null);

    try {
      const response = await fetch("/api/current-plan/init", {
        method: "GET",
        cache: "no-store",
      });

      if (!isMountedRef.current) {
        return;
      }

      if (response.status === 404) {
        setSavedPlan(null);
        setParsedPlan(null);
        setPlanEntrySnapshot(null);
        setUsageSnapshot(null);
        setHasActiveUsage(false);
        setHasAwarded(false);
        setReconfirmMessage(null);
        setLoadingSavedPlan(false);
        return;
      }

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload?.error ?? "Unable to load your saved current plan.";
        throw new Error(message);
      }

      if (!isMountedRef.current) {
        return;
      }

      const nextPlanEntrySnapshot = payload?.entry ?? null;
      setSavedPlan(payload?.savedCurrentPlan ?? null);
      setParsedPlan(payload?.parsedCurrentPlan ?? null);
      setPlanVariablesUsed(payload?.planVariablesUsed ?? null);
      setPlanVariablesList(Array.isArray(payload?.planVariablesList) ? payload.planVariablesList : null);
      setPlanEntrySnapshot(nextPlanEntrySnapshot);
      setUsageSnapshot(payload?.usage ?? null);

      const entryStatus: string | null = nextPlanEntrySnapshot?.status ?? null;
      const entryActive =
        entryStatus === "ACTIVE" || entryStatus === "EXPIRING_SOON";
      const usageActive = Boolean(payload?.hasActiveUsage);
      setHasActiveUsage(usageActive || entryActive);

      setHasAwarded(entryActive);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load your saved current plan.";
      setSavedPlanError(message);
      setSavedPlan(null);
      setParsedPlan(null);
      setPlanVariablesUsed(null);
      setPlanVariablesList(null);
      setPlanEntrySnapshot(null);
      setUsageSnapshot(null);
      setHasActiveUsage(false);
      setHasAwarded(false);
      setReconfirmMessage(null);
    } finally {
      if (!isMountedRef.current) {
        return;
      }
      setLoadingSavedPlan(false);
    }
  }, []);

  useEffect(() => {
    refreshPlan().catch(() => {
      /* handled in refreshPlan */
    });

    const handleEntriesUpdated = () => {
      refreshPlan().catch(() => {
        /* handled in refreshPlan */
      });
    };

    window.addEventListener("entriesUpdated", handleEntriesUpdated);
    return () => {
      window.removeEventListener("entriesUpdated", handleEntriesUpdated);
    };
  }, [refreshPlan]);

  // Auto-fill the manual entry form from savedCurrentPlan (preferred) or parsedCurrentPlan.
  useEffect(() => {
    if (!isMountedRef.current) return;
    if (hasInitializedFromPlanRef.current) return;

    if (!savedPlan && !parsedPlan) return;

    hasInitializedFromPlanRef.current = true;

    const saved = savedPlan;
    const parsed = parsedPlan;

    const pickString = (savedVal?: string | null, parsedVal?: string | null) => {
      if (savedVal && savedVal.trim().length > 0) return savedVal.trim();
      if (parsedVal && parsedVal.trim().length > 0) return parsedVal.trim();
      return null;
    };

    const pickNumber = (savedVal?: number | null, parsedVal?: number | null) => {
      if (savedVal !== null && savedVal !== undefined) return savedVal;
      if (parsedVal !== null && parsedVal !== undefined) return parsedVal;
      return null;
    };

    const pickedProvider = pickString(saved?.providerName, parsed?.providerName);
    if (!electricCompany && pickedProvider) {
      setElectricCompany(pickedProvider);
    }

    const pickedPlanName = pickString(saved?.planName, parsed?.planName);
    if (!planName && pickedPlanName) {
      setPlanName(pickedPlanName);
    }

    const pickedRateType = pickString(saved?.rateType, parsed?.rateType);
    if (pickedRateType === "FIXED" || pickedRateType === "VARIABLE" || pickedRateType === "TIME_OF_USE") {
      setRateType(pickedRateType);
    }

    const pickedBaseFee = pickNumber(saved?.baseMonthlyFee, parsed?.baseMonthlyFee);
    if (baseFeeDollars === "" && pickedBaseFee !== null) {
      setBaseFeeDollars(String(pickedBaseFee));
    }

    const pickedTermMonths = pickNumber(saved?.termLengthMonths, parsed?.termLengthMonths);
    if (termLengthMonths === "" && pickedTermMonths !== null) {
      setTermLengthMonths(String(pickedTermMonths));
    }

    const pickedContractEnd =
      saved?.contractEndDate ?? parsed?.contractEndDate ?? null;
    if (contractExpiration === "" && pickedContractEnd) {
      setContractExpiration(pickedContractEnd.slice(0, 10));
    }

    const pickedEarlyTermination = pickNumber(
      saved?.earlyTerminationFee,
      parsed?.earlyTerminationFee,
    );
    if (earlyTerminationFee === "" && pickedEarlyTermination !== null) {
      setEarlyTerminationFee(String(pickedEarlyTermination));
    }

    const pickedEsiId = pickString(saved?.esiId, parsed?.esiId);
    if (!esiId && pickedEsiId) {
      setEsiId(pickedEsiId);
    }

    const pickedAccountLast = pickString(
      saved?.accountNumberLast4,
      parsed?.accountNumberLast4,
    );
    if (!accountNumberLast4 && pickedAccountLast) {
      setAccountNumberLast4(pickedAccountLast);
    }

    const pickedNotes = pickString(saved?.notes, parsed?.notes);
    if (!notes && pickedNotes) {
      setNotes(pickedNotes);
    }

    const structure =
      (saved && saved.rateStructure) ||
      (parsed && parsed.rateStructure) ||
      null;
    if (structure && typeof structure === "object") {
      if (structure.type === "FIXED" && structure.energyRateCents != null && primaryRateCentsPerKwh === "") {
        setPrimaryRateCentsPerKwh(String(structure.energyRateCents));
      }
      if (structure.type === "VARIABLE") {
        if (structure.currentBillEnergyRateCents != null && primaryRateCentsPerKwh === "") {
          setPrimaryRateCentsPerKwh(String(structure.currentBillEnergyRateCents));
        }
        if (structure.indexType && !variableIndexType) {
          if (structure.indexType === "ERCOT" || structure.indexType === "FUEL" || structure.indexType === "OTHER") {
            setVariableIndexType(structure.indexType);
          }
        }
        if (structure.variableNotes && !variableNotes) {
          setVariableNotes(structure.variableNotes);
        }
      }
      if (
        structure.tdspDeliveryIncludedInEnergyCharge === true &&
        deliveryIncluded === null
      ) {
        setDeliveryIncluded(true);
      }
      if (structure.billCredits && typeof structure.billCredits === "object") {
        const bc = structure.billCredits as BillCreditStructure;
        if (bc.hasBillCredit && bc.rules && bc.rules.length > 0) {
          setIncludeBillCredits(true);
          const rules: BillCreditRuleForm[] = bc.rules.map((rule, idx) => ({
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${idx}-${Math.random().toString(36).slice(2)}`,
            label: rule.label,
            creditAmount: rule.creditAmountCents != null ? String(rule.creditAmountCents / 100) : "",
            minUsage: rule.minUsageKWh != null ? String(rule.minUsageKWh) : "",
            maxUsage: rule.maxUsageKWh != null ? String(rule.maxUsageKWh) : "",
            applyAllMonths: !rule.monthsOfYear || rule.monthsOfYear.length === 0,
            selectedMonths: rule.monthsOfYear ?? [],
          }));
          setBillCreditRules(rules.length > 0 ? rules : [createEmptyBillCreditRule()]);
        }
      }
      if (structure.type === "TIME_OF_USE" && Array.isArray((structure as any).tiers)) {
        const tiersSource = (structure as any).tiers as TimeOfUseTier[];
        const mapped: TimeOfUseTierForm[] = tiersSource.map((tier, idx) => ({
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${idx}-${Math.random().toString(36).slice(2)}`,
          label: tier.label,
          priceCents: tier.priceCents != null ? String(tier.priceCents) : "",
          startTime: tier.startTime ?? "",
          endTime: tier.endTime ?? "",
          useAllDays: tier.daysOfWeek === "ALL",
          selectedDays: Array.isArray(tier.daysOfWeek) ? tier.daysOfWeek : [],
          selectedMonths: tier.monthsOfYear ?? [],
        }));
        if (mapped.length > 0) {
          setTouTiers(mapped);
          setRateType("TIME_OF_USE");
        }
      }
    }
  }, [
    parsedPlan,
    savedPlan,
    electricCompany,
    planName,
    rateType,
    baseFeeDollars,
    termLengthMonths,
    contractExpiration,
    earlyTerminationFee,
    esiId,
    accountNumberLast4,
    notes,
    primaryRateCentsPerKwh,
    variableIndexType,
    variableNotes,
  ]);

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

  const entryStatus = planEntrySnapshot?.status ?? null;
  const usageStatus = usageSnapshot?.status ?? null;

  const isEntryLive =
    entryStatus === "ACTIVE" || entryStatus === "EXPIRING_SOON";

  const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === "object" && value && "toNumber" in (value as Record<string, unknown>)) {
      try {
        const result = (value as { toNumber?: () => number }).toNumber?.();
        return typeof result === "number" && Number.isFinite(result) ? result : null;
      } catch {
        return null;
      }
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatRate = (value: number | null) => {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }
    const trimmed = value.toFixed(4).replace(/(?:\.0+|0+)$/, "");
    return `${trimmed} ¢/kWh`;
  };

  const formatCurrency = (value: number | null) => {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }
    return `$${value.toFixed(2)}`;
  };

  const formatNumber = (value: number | null) => {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }
    return `${value}`;
  };

  const statusBadgeClass = (status: string | null) => {
    switch (status) {
      case "ACTIVE":
        return "rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200 border border-emerald-400/30";
      case "EXPIRING_SOON":
        return "rounded-full bg-amber-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 border border-amber-300/40";
      case "EXPIRED":
        return "rounded-full bg-rose-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-200 border border-rose-300/40";
      default:
        return "rounded-full bg-slate-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 border border-slate-400/30";
    }
  };

  const derivedUsageStatus =
    hasActiveUsage
      ? usageStatus === "ACTIVE" || usageStatus === "EXPIRING_SOON"
        ? usageStatus
        : "ACTIVE"
      : usageStatus;

  const renderStatusBadge = (status: string | null, label: string) => (
    <span className={statusBadgeClass(status)}>
      {label}: {status ?? "—"}
    </span>
  );

  const savedPlanRateStructure =
    savedPlan && savedPlan.rateStructure && typeof savedPlan.rateStructure === "object"
      ? savedPlan.rateStructure
      : null;

  const timeOfUseTiers: Array<any> =
    savedPlanRateStructure && Array.isArray(savedPlanRateStructure.tiers)
      ? savedPlanRateStructure.tiers
      : [];

  const billCreditRulesSummary: Array<any> =
    savedPlanRateStructure &&
    savedPlanRateStructure.billCredits &&
    savedPlanRateStructure.billCredits.hasBillCredit &&
    Array.isArray(savedPlanRateStructure.billCredits.rules)
      ? savedPlanRateStructure.billCredits.rules
      : [];

  const snapshotCardClasses =
    "rounded-2xl border border-brand-cyan/40 bg-brand-navy/60 px-4 py-3 text-sm text-brand-cyan";
  const snapshotLabelClasses =
    "text-xs font-semibold uppercase tracking-wide text-brand-cyan/70";

  async function uploadBill(options: { silent?: boolean } = {}): Promise<boolean> {
    const { silent = false } = options;

    if (files.length === 0) {
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
      files.forEach((bill) => {
        formData.append("billFile", bill);
      });

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
      setFiles([]);
      if (!silent) {
        const message = entryAwarded
          ? "✓ Bill pages uploaded and bonus entry recorded."
          : alreadyAwarded
          ? "Bill pages uploaded. You've already earned the current plan entry."
          : "✓ Bill pages uploaded and saved securely.";
        setUploadStatus(message);
      }

      // After a successful upload, run the bill parser so parsedCurrentPlan is
      // populated for this user/house, then refresh the form from the result.
      try {
        await fetch("/api/current-plan/bill-parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // houseId is optional here; the API will fall back to the latest
          // uploaded bill for this user when none is provided.
          body: JSON.stringify({}),
        });
      } catch {
        // Best-effort; upload success is still valuable even if parsing fails.
      }

      await refreshPlan();
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

  async function parseEflFactLabel(): Promise<boolean> {
    if (!eflFile) {
      setEflParseStatus("Select an EFL PDF first.");
      return false;
    }

    try {
      setIsParsingEfl(true);
      setEflParseStatus(null);

      const fd = new FormData();
      fd.append("eflFile", eflFile);
      const houseId = parsedPlan?.houseId ?? savedPlan?.houseId ?? null;
      if (houseId) fd.append("houseId", houseId);

      const r = await fetch("/api/current-plan/efl-parse", {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setEflParseStatus(j?.error ? String(j.error) : `EFL parse failed (${r.status})`);
        return false;
      }

      const p = j?.prefill ?? {};
      if (typeof p?.providerName === "string") setElectricCompany(p.providerName);
      if (typeof p?.planName === "string") setPlanName(p.planName);
      if (typeof p?.rateType === "string" && ["FIXED", "VARIABLE", "TIME_OF_USE"].includes(p.rateType)) {
        setRateType(p.rateType as any);
      }
      if (typeof p?.termLengthMonths === "number" && Number.isFinite(p.termLengthMonths)) {
        setTermLengthMonths(String(p.termLengthMonths));
      }
      if (typeof p?.energyRateCentsPerKwh === "number" && Number.isFinite(p.energyRateCentsPerKwh)) {
        setPrimaryRateCentsPerKwh(String(p.energyRateCentsPerKwh));
      }
      if (typeof p?.baseMonthlyFeeDollars === "number" && Number.isFinite(p.baseMonthlyFeeDollars)) {
        setBaseFeeDollars(String(p.baseMonthlyFeeDollars.toFixed(2)));
      }
      if (typeof p?.earlyTerminationFeeDollars === "number" && Number.isFinite(p.earlyTerminationFeeDollars)) {
        setEarlyTerminationFee(String(p.earlyTerminationFeeDollars.toFixed(2)));
      }

      const credits = Array.isArray(p?.billCredits) ? p.billCredits : [];
      if (credits.length > 0) {
        setIncludeBillCredits(true);
        setBillCreditRules(() =>
          credits.map((c: any) => ({
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? (crypto as any).randomUUID()
                : Math.random().toString(36).slice(2),
            label: typeof c?.label === "string" ? c.label : "Bill credit",
            creditAmount: typeof c?.creditCents === "number" ? String((c.creditCents / 100).toFixed(2)) : "",
            minUsage: typeof c?.thresholdKwh === "number" ? String(c.thresholdKwh) : "",
            maxUsage: "",
            applyAllMonths: true,
            selectedMonths: [],
          })),
        );
      }

      const tou = Array.isArray(p?.touWindows) ? p.touWindows : [];
      if (tou.length > 0) {
        setRateType("TIME_OF_USE");
        setTouTiers(() =>
          tou.map((t: any, idx: number) => ({
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? (crypto as any).randomUUID()
                : Math.random().toString(36).slice(2),
            label: `Period ${idx + 1}`,
            priceCents: typeof t?.cents === "number" ? String(t.cents) : "",
            startTime: typeof t?.start === "string" ? t.start : "",
            endTime: typeof t?.end === "string" ? t.end : "",
            useAllDays: true,
            selectedDays: [],
            selectedMonths: [],
          })),
        );
      }

      setPrefilledFromEfl(true);
      setEflParseStatus("EFL parsed. We pre-filled your fields—please double-check everything before saving.");
      return true;
    } catch (e: any) {
      setEflParseStatus(e?.message ?? "EFL parse failed.");
      return false;
    } finally {
      setIsParsingEfl(false);
    }
  }

  async function parsePastedBillTextForCurrentPlan() {
    const houseId =
      parsedPlan?.houseId ?? savedPlan?.houseId ?? null;

    if (!houseId) {
      setPasteError(
        "We couldn't find your home record. Try refreshing the page and then paste the text again.",
      );
      return;
    }

    if (!pastedBillText.trim()) {
      setPasteError("Paste the visible text from your bill before running the parser.");
      return;
    }

    try {
      setIsParsingPaste(true);
      setPasteError(null);

      const res = await fetch("/api/current-plan/bill-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          textOverride: pastedBillText.trim(),
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
      setPastedBillText("");

      setUploadStatus("Bill text parsed. Your current plan details below have been refreshed.");
      await refreshPlan();
    } catch (err: any) {
      setPasteError(
        err?.message ?? "Something went wrong while parsing that text. Please try again.",
      );
    } finally {
      setIsParsingPaste(false);
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

      if (files.length > 0 && !billUploaded) {
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
      if (!manualPayload.billUploaded) {
        await refreshPlan();
      }
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

  const handleReconfirm = useCallback(async () => {
    if (!savedPlan) {
      setReconfirmMessage("Save your current plan details first.");
      return;
    }

    setReconfirmMessage(null);
    setReconfirming(true);

    try {
      const response = await fetch("/api/current-plan/reconfirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId: savedPlan.houseId }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload?.error ?? "Unable to reconfirm your current plan right now.";
        throw new Error(message);
      }

      const entryStatus: string | null = payload?.entry?.status ?? null;
      const usageStatus: string | null = payload?.usage?.status ?? null;
      let message: string;
      if (entryStatus === "ACTIVE") {
        message = "Plan reconfirmed and your entry is active again.";
      } else if (entryStatus === "EXPIRING_SOON") {
        message = "Plan reconfirmed. Entry is expiring soon—keep usage connected.";
      } else if (usageStatus === "ACTIVE" || usageStatus === "EXPIRING_SOON") {
        message = "Plan reconfirmed. Entry will reactivate shortly.";
      } else {
        message =
          "Plan reconfirmed. Reconnect SMT or upload fresh usage to reactivate the entry.";
      }

      window.dispatchEvent(new CustomEvent("entriesUpdated"));
      await refreshPlan();
      if (isMountedRef.current) {
        setReconfirmMessage(message);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to reconfirm your current plan right now.";
      if (isMountedRef.current) {
        setReconfirmMessage(message);
      }
    } finally {
      if (isMountedRef.current) {
        setReconfirming(false);
      }
    }
  }, [refreshPlan, savedPlan]);

  return (
    <div className="space-y-8">
      {!hasActiveUsage ? (
        <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 text-sm text-brand-navy shadow-[0_18px_45px_rgba(190,18,60,0.18)]">
          Current plan entries unlock only after IntelliWatt has active usage data. Connect Smart Meter Texas or upload usage on{" "}
          <a
            href="/dashboard/api"
            className="font-semibold underline decoration-dotted underline-offset-4 text-brand-navy hover:text-brand-navy/80"
          >
            the API Connect page
          </a>{" "}
          to enable this step.
        </div>
      ) : null}

      <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_24px_60px_rgba(16,46,90,0.25)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
              Saved Plan Snapshot
            </h2>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Review the plan you previously shared. Reconfirm whenever SMT or manual usage reconnects.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
            {renderStatusBadge(entryStatus, "Current plan entry")}
            {renderStatusBadge(derivedUsageStatus, "Usage connection")}
          </div>
        </div>

        {loadingSavedPlan ? (
          <div className="mt-4 rounded-2xl border border-brand-blue/25 bg-brand-blue/5 px-4 py-3 text-sm text-brand-blue">
            Loading your saved plan…
          </div>
        ) : savedPlanError ? (
          <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {savedPlanError}
          </div>
        ) : savedPlan ? (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Provider
                </p>
                <p className="mt-1 font-semibold">{savedPlan.providerName}</p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Plan name
                </p>
                <p className="mt-1 font-semibold">{savedPlan.planName}</p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Rate type
                </p>
                <p className="mt-1 font-semibold">{savedPlan.rateType}</p>
                <p className="mt-1 text-xs text-brand-cyan/70">
                  {savedPlan.rateType === "FIXED" || savedPlan.rateType === "VARIABLE"
                    ? `Energy rate: ${formatRate(
                        toNumber(
                          savedPlan.energyRateCents ?? savedPlanRateStructure?.energyRateCents ?? null,
                        ),
                      )}`
                    : savedPlan.rateType === "TIME_OF_USE"
                    ? "Time-of-use pricing"
                    : "See details below"}
                </p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Base monthly fee
                </p>
                <p className="mt-1 font-semibold">{formatCurrency(savedPlan.baseMonthlyFee)}</p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Term length
                </p>
                <p className="mt-1 font-semibold">
                  {savedPlan.termLengthMonths ? `${savedPlan.termLengthMonths} months` : "—"}
                </p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Contract end
                </p>
                <p className="mt-1 font-semibold">
                  {savedPlan.contractEndDate ? (
                    <LocalTime value={savedPlan.contractEndDate} />
                  ) : (
                    "—"
                  )}
                </p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Early termination fee
                </p>
                <p className="mt-1 font-semibold">
                  {formatCurrency(savedPlan.earlyTerminationFee)}
                </p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  ESIID
                </p>
                <p className="mt-1 font-semibold">{savedPlan.esiId ?? "—"}</p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Account (last digits)
                </p>
                <p className="mt-1 font-semibold">{savedPlan.accountNumberLast4 ?? "—"}</p>
              </div>
              <div className={snapshotCardClasses}>
                <p className={snapshotLabelClasses}>
                  Bill credit summary
                </p>
                <p className="mt-1 font-semibold">
                  {formatCurrency(savedPlan.billCreditDollars)}
                </p>
              </div>
            </div>

            {savedPlanRateStructure?.type === "TIME_OF_USE" && timeOfUseTiers.length > 0 ? (
              <div className={`${snapshotCardClasses} mt-5 space-y-2`}>
                <p className={snapshotLabelClasses}>
                  Time-of-use tiers
                </p>
                <div className="grid gap-3 text-xs text-brand-cyan sm:grid-cols-2">
                  {timeOfUseTiers.map((tier: any, index: number) => (
                    <div
                      key={`${tier.label ?? "tier"}-${index}`}
                      className="rounded-xl border border-brand-cyan/30 bg-brand-navy/50 px-3 py-2 shadow-sm text-brand-cyan"
                    >
                      <p className="font-semibold text-brand-cyan">
                        {(tier.label as string) ?? `Tier ${index + 1}`}
                      </p>
                      <p className="mt-1 text-brand-cyan/70">
                        Rate: {formatRate(toNumber(tier.priceCents))}
                      </p>
                      <p className="text-brand-cyan/70">
                        Window: {tier.startTime ?? "—"} → {tier.endTime ?? "—"}
                      </p>
                      <p className="text-brand-cyan/70">
                        Days:{" "}
                        {Array.isArray(tier.daysOfWeek)
                          ? (tier.daysOfWeek as string[]).join(", ")
                          : tier.daysOfWeek === "ALL"
                          ? "All days"
                          : "—"}
                      </p>
                      {Array.isArray(tier.monthsOfYear) && tier.monthsOfYear.length > 0 ? (
                        <p className="text-brand-cyan/70">
                          Months: {tier.monthsOfYear.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {billCreditRulesSummary.length > 0 ? (
              <div className={`${snapshotCardClasses} mt-5 space-y-2`}>
                <p className={snapshotLabelClasses}>
                  Bill credit rules
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-brand-cyan/80">
                  {billCreditRulesSummary.map((rule: any, index: number) => {
                    const creditAmount = toNumber(rule.creditAmountCents);
                    return (
                      <li key={`bill-credit-${index}`}>
                        <span className="font-semibold">
                          {rule.label ?? `Credit ${index + 1}`}
                        </span>
                        {rule.minUsageKWh != null ? ` · Min ${rule.minUsageKWh} kWh` : ""}
                        {rule.maxUsageKWh != null ? ` · Max ${rule.maxUsageKWh} kWh` : ""}
                        {creditAmount !== null ? ` · ${formatCurrency(creditAmount / 100)}` : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className={`${snapshotCardClasses} mt-5`}>
              <p className={snapshotLabelClasses}>Plan variables used</p>
              <div className="mt-2 space-y-1 text-sm text-brand-cyan/85">
                {Array.isArray(planVariablesList) && planVariablesList.length > 0 ? (
                  planVariablesList.map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-3">
                      <span>{row.label}</span>
                      <span className="font-semibold text-brand-white/90">{row.value}</span>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span>REP energy</span>
                      <span className="font-semibold text-brand-white/90">
                        {planVariablesUsed?.rep?.energyCentsPerKwh != null
                          ? `${Number(planVariablesUsed.rep.energyCentsPerKwh).toFixed(4)}¢/kWh`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>REP fixed</span>
                      <span className="font-semibold text-brand-white/90">
                        {planVariablesUsed?.rep?.fixedMonthlyChargeDollars != null
                          ? `${formatCurrency(Number(planVariablesUsed.rep.fixedMonthlyChargeDollars))}/mo`
                          : "—/mo"}
                      </span>
                    </div>
                    <div className="my-2 h-px w-full bg-brand-cyan/15" />
                    <div className="flex items-center justify-between gap-3">
                      <span>TDSP delivery</span>
                      <span className="font-semibold text-brand-white/90">
                        {planVariablesUsed?.tdsp?.perKwhDeliveryChargeCents != null
                          ? `${Number(planVariablesUsed.tdsp.perKwhDeliveryChargeCents).toFixed(4)}¢/kWh`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>TDSP customer</span>
                      <span className="font-semibold text-brand-white/90">
                        {planVariablesUsed?.tdsp?.monthlyCustomerChargeDollars != null
                          ? `${formatCurrency(Number(planVariablesUsed.tdsp.monthlyCustomerChargeDollars))}/mo`
                          : "—/mo"}
                      </span>
                    </div>
                    {planVariablesUsed?.tdsp?.effectiveDate ? (
                      <div className="mt-1 text-xs text-brand-cyan/70">
                        TDSP effective:{" "}
                        <span className="font-mono text-brand-white/90">
                          {String(planVariablesUsed.tdsp.effectiveDate).slice(0, 10)}
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="mt-2 text-xs text-brand-cyan/60">
                These are the exact variables IntelliWatt uses for comparisons. Please verify your current plan details above.
              </div>
            </div>

            {savedPlan.notes ? (
              <div className={`${snapshotCardClasses} mt-5 text-sm`}>
                <p className={snapshotLabelClasses}>
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-wrap text-brand-cyan/80">{savedPlan.notes}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-brand-cyan/70">
              <span>
                Last updated: <LocalTime value={savedPlan.updatedAt} />
              </span>
              <span>
                Last confirmed:{" "}
                {savedPlan.lastConfirmedAt ? (
                  <LocalTime value={savedPlan.lastConfirmedAt} />
                ) : (
                  "—"
                )}
              </span>
            </div>

            {!hasActiveUsage ? (
              <div className="mt-4 rounded-xl border border-amber-400/60 bg-amber-500/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                Reconnect SMT, Green Button, or upload usage to re-activate this entry after reconfirming.
              </div>
            ) : !isEntryLive && planEntrySnapshot ? (
              <div className="mt-4 rounded-xl border border-brand-cyan/40 bg-brand-navy px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-brand-cyan">
                Usage is active. Reconfirm your saved plan to re-award this entry.
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleReconfirm}
                  disabled={reconfirming || !savedPlan || loadingSavedPlan}
                  className="inline-flex items-center rounded-full bg-brand-navy px-5 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_24px_rgba(16,46,90,0.25)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reconfirming ? "Reconfirming…" : "Reconfirm saved plan"}
                </button>
                <button
                  type="button"
                  onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="inline-flex items-center rounded-full border border-brand-blue px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:bg-brand-blue/10"
                >
                  Update plan details
                </button>
              </div>
              <div className="text-xs text-brand-cyan/80">
                Need to make changes? Update your info or reconfirm once usage reconnects.
              </div>
            </div>

            {reconfirmMessage ? (
              <div className="mt-3 rounded-xl border border-brand-blue/30 bg-brand-blue/5 px-4 py-3 text-xs text-brand-blue">
                {reconfirmMessage}
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-brand-blue/25 bg-brand-blue/5 px-4 py-3 text-sm text-brand-slate">
            No plan on file yet. Upload a bill or enter details below to earn the Current Plan entry once usage data is active.
          </div>
        )}
      </div>

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
          <h2 className="text-base font-semibold text-brand-navy">Option 0 · Upload your plan’s Electricity Facts Label (EFL)</h2>
          <p className="text-sm text-brand-slate">
            Upload the EFL/fact label PDF for your current plan and we&apos;ll prefill the fields below using the same PDF-to-text
            pipeline we use for offer EFL processing. Please <span className="font-semibold">double-check everything</span> and
            override anything that looks off.
          </p>

          <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-6 text-center text-sm text-brand-navy transition hover:border-brand-blue/60 hover:bg-brand-blue/10">
            <span className="font-semibold">Drag your EFL PDF here or click to browse</span>
            <span className="mt-1 text-xs text-brand-slate">
              Accepted file: <span className="font-semibold">PDF only</span>
            </span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple={false}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                setEflFile(f);
                setEflParseStatus(null);
                setPrefilledFromEfl(false);
              }}
              className="hidden"
            />
          </label>

          {eflFile ? (
            <div className="rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-3 text-xs text-brand-navy">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold truncate">{eflFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setEflFile(null);
                    setEflParseStatus(null);
                    setPrefilledFromEfl(false);
                  }}
                  className="text-rose-600 hover:text-rose-700"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={parseEflFactLabel}
            disabled={!eflFile || isParsingEfl}
            className="inline-flex items-center rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_24px_rgba(16,46,90,0.25)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isParsingEfl ? "Parsing…" : "Parse EFL and prefill"}
          </button>

          {eflParseStatus ? (
            <p className={`text-sm ${prefilledFromEfl ? "text-emerald-700" : "text-rose-700"}`}>
              {eflParseStatus}
            </p>
          ) : null}
        </div>
        <div
          id="bill-upload"
          className="space-y-4 rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-sm sm:p-7"
        >
          <h2 className="text-base font-semibold text-brand-navy">Option 1 · Upload your latest bill</h2>
          <p className="text-sm text-brand-slate">
            Upload a recent PDF bill and we&apos;ll parse it to auto-fill your plan data. If you only
            have a screenshot or image, you can paste the copied text instead.
          </p>
          <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-6 text-center text-sm text-brand-navy transition hover:border-brand-blue/60 hover:bg-brand-blue/10">
            <span className="font-semibold">Drag your PDF here or click to browse</span>
            <span className="mt-1 text-xs text-brand-slate">
              Accepted file: <span className="font-semibold">PDF only</span>. If your bill is an image or screenshot,
              open it and use the paste link below to send us the visible text instead.
            </span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple={false}
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                if (selected.length > 0) {
                  setFiles((prev) => [...prev, ...selected]);
                } else {
                  setFiles([]);
                }
                setBillUploaded(false);
                setUploadStatus(null);
              }}
              className="hidden"
            />
          </label>
          {files.length > 0 ? (
            <ul className="space-y-2 rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-3 text-xs text-brand-navy">
              {files.map((bill, index) => (
                <li key={`${bill.name}-${bill.size}-${index}`} className="flex items-center justify-between gap-3">
                  <span className="font-semibold truncate">{bill.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFiles((prev) => prev.filter((_, idx) => idx !== index));
                      setBillUploaded(false);
                    }}
                    className="text-rose-600 hover:text-rose-700"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => uploadBill()}
            disabled={files.length === 0 || isUploading}
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
          <button
            type="button"
            onClick={() => {
              setShowPasteModal(true);
              setPasteError(null);
            }}
            className="mt-2 text-xs font-semibold text-brand-blue underline underline-offset-4 hover:text-brand-blue/80"
          >
            Or paste copied bill text instead
          </button>
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
                    If your bill is a screenshot or scanned image, open it and copy the visible
                    text (provider, plan name, service address, pricing rows) into the box below.
                    We&apos;ll run the same parser used for PDF uploads and refresh your plan
                    details.
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
                <textarea
                  className="h-40 w-full resize-none rounded-lg border border-brand-blue/30 px-3 py-2 text-xs font-mono text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                  placeholder="Paste the text from your bill here..."
                  value={pastedBillText}
                  onChange={(e) => setPastedBillText(e.target.value)}
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
                  onClick={parsePastedBillTextForCurrentPlan}
                  disabled={isParsingPaste}
                  className="rounded-full bg-brand-navy px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_6px_18px_rgba(16,46,90,0.35)] hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isParsingPaste ? "Parsing…" : "Parse pasted text"}
                </button>
              </div>
            </div>
          </div>
        )}

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-4 rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-sm sm:p-7"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-brand-navy">Option 2 · Enter plan details manually</h2>
            <Link
              href="#bill-upload"
              className="text-xs font-semibold uppercase tracking-wide text-brand-blue underline decoration-dotted underline-offset-4 hover:text-brand-blue/80"
            >
              Prefer to upload your bill?
            </Link>
          </div>
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

          <div className="space-y-2 rounded-2xl border border-brand-blue/30 bg-brand-blue/5 p-4 text-sm text-brand-navy">
            <div className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Delivery included in energy charge?
            </div>
            <p className="text-xs text-brand-navy/70">
              Turn this on if the REP&apos;s EFL or bill clearly states that the energy charge
              already includes TDSP/TDU delivery charges. When enabled, IntelliWatt can treat the
              rate as &quot;delivery included&quot; when comparing against other plans.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="deliveryIncluded"
                  checked={deliveryIncluded === true}
                  onChange={() => setDeliveryIncluded(true)}
                  className="h-4 w-4 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                />
                <span>Yes, my energy rate includes TDSP/TDU delivery</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="deliveryIncluded"
                  checked={deliveryIncluded === false}
                  onChange={() => setDeliveryIncluded(false)}
                  className="h-4 w-4 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
                />
                <span>No, TDSP delivery is billed separately</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="deliveryIncluded"
                  checked={deliveryIncluded === null}
                  onChange={() => setDeliveryIncluded(null)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-500 focus:ring-brand-blue"
                />
                <span>Not sure / not stated</span>
              </label>
            </div>
          </div>

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

