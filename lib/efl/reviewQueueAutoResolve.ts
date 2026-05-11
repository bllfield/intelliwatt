export function requiresStrongTemplateMatchForQueueItem(item: any): boolean {
  const src = String(item?.source ?? "").trim().toLowerCase();
  const finalStatus = String(item?.finalStatus ?? "").trim().toUpperCase();
  const queueReason = String(item?.queueReason ?? "").trim();
  const hasRawText = String(item?.rawText ?? "").trim().length > 0;
  const hasRateStructure = Boolean(item?.rateStructure);
  const hasPlanRules = Boolean(item?.planRules);
  const hasRepAndVersion =
    String(item?.repPuctCertificate ?? "").trim().length > 0 &&
    String(item?.eflVersionCode ?? "").trim().length > 0;

  const looksLikeFetchFailure =
    /fetch failed|did not return a pdf|no ['"]?electricity facts label['"]? pdf link|missing docs\.efl|no enroll_link/i.test(
      queueReason,
    );

  if (!src.startsWith("wattbuy")) return false;
  if (!looksLikeFetchFailure) return false;

  // When we never fetched/parsing never started, a URL-only template match is too weak:
  // the row should stay OPEN until we can verify the actual EFL identity.
  return finalStatus === "SKIP" && !hasRawText && !hasRateStructure && !hasPlanRules && !hasRepAndVersion;
}
