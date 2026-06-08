import { isHouseCommittedToGreenButton } from "@/lib/usage/houseCommittedUsageSource";

/** SMT pull/heal/backfill must not run when the home is Green Button (stored or legacy-inferred). */
export async function isSmtBackfillBlockedForGreenButtonHome(args: {
  houseId: string;
  userId?: string | null;
  esiid?: string | null;
}): Promise<boolean> {
  return isHouseCommittedToGreenButton({
    houseId: args.houseId,
    userId: args.userId ?? null,
    esiid: args.esiid ?? null,
  });
}

/**
 * User-facing SMT orchestration runs only for SMT homes: stored commit or legacy-inferred active SMT.
 * Manual / uncommitted homes are excluded without requiring a production backfill migration.
 */
export async function isUserFacingSmtBackfillAllowed(args: {
  houseId: string;
  userId?: string | null;
  esiid?: string | null;
}): Promise<boolean> {
  if (await isSmtBackfillBlockedForGreenButtonHome(args)) return false;

  const { readHouseCommittedUsageSource } = await import("@/lib/usage/commitHouseUsageSource");
  const stored = await readHouseCommittedUsageSource(args.houseId);
  if (stored === "SMT") return true;
  if (stored === "GREEN_BUTTON") return false;

  const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
  const resolved = await resolveHouseCommittedUsageSource({
    houseId: args.houseId,
    userId: args.userId ?? null,
    esiid: args.esiid ?? null,
  });
  return resolved === "SMT";
}
