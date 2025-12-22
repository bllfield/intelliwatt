export function isComputableOverride(
  planCalcStatus: string | null | undefined,
  planCalcReasonCode: string | null | undefined,
): boolean {
  const status = String(planCalcStatus ?? "").trim().toUpperCase();
  const reason = String(planCalcReasonCode ?? "").trim().toUpperCase();
  if (status !== "COMPUTABLE") return false;
  // Ops sometimes forces COMPUTABLE even when derived computability helpers say NOT_COMPUTABLE.
  // When forced, we still allow estimates to be computed and cached.
  return reason === "ADMIN_OVERRIDE_COMPUTABLE" || reason === "FORCED_COMPUTABLE" || reason === "OVERRIDE";
}


