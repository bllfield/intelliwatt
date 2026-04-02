import {
  GAPFILL_LAB_TEST_HOME_LABEL,
  MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
} from "@/modules/usageSimulator/labTestHome";

const GAPFILL_LAB_TEST_HOME_ADDRESS = "gap-fill canonical lab test home";
const MANUAL_MONTHLY_LAB_TEST_HOME_ADDRESS = "manual monthly lab test home";

export function isInternalLabHomeIdentity(label: unknown, addressLine1?: unknown): boolean {
  const l = String(label ?? "").trim();
  const a = String(addressLine1 ?? "").trim().toLowerCase();
  return (
    l === GAPFILL_LAB_TEST_HOME_LABEL ||
    l === MANUAL_MONTHLY_LAB_TEST_HOME_LABEL ||
    a === GAPFILL_LAB_TEST_HOME_ADDRESS ||
    a === MANUAL_MONTHLY_LAB_TEST_HOME_ADDRESS
  );
}

export function toPublicHouseLabel(args: {
  label?: unknown;
  addressLine1?: unknown;
  fallbackId?: unknown;
}): string {
  if (isInternalLabHomeIdentity(args.label, args.addressLine1)) return "Home";
  const label = String(args.label ?? "").trim();
  if (label) return label;
  const addressLine1 = String(args.addressLine1 ?? "").trim();
  if (addressLine1) return addressLine1;
  const fallbackId = String(args.fallbackId ?? "").trim();
  return fallbackId || "Home";
}
