import { lookupAdminHousesByEmail, resolveAdminHouseSelection, type AdminHouseLookupRow } from "@/lib/admin/adminHouseLookup";
import { resolveManualGapfillSmtSourceContext } from "@/modules/manualUsage/manualGapfillSourceContext";
import { ensureGlobalOnePathLabTestHomeHouse, getOnePathLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";
import { prisma } from "@/lib/db";
import type { ModelIntelligenceLabContext } from "@/modules/modelIntelligence/types";

function mapActualSourceKind(
  kind: "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous"
): ModelIntelligenceLabContext["actualSourceKind"] {
  if (kind === "SMT") return "SMT";
  if (kind === "GREEN_BUTTON") return "GREEN_BUTTON";
  if (kind === "ambiguous") return "ambiguous";
  return "none";
}

async function resolveLabTestHomeState(args: {
  ownerUserId: string;
  selectedSourceHouseId: string;
  selectedSourceUserId: string;
}) {
  const ensured = await ensureGlobalOnePathLabTestHomeHouse(args.ownerUserId);
  const link = await getOnePathLabTestHomeLink(args.ownerUserId);
  const testHomeHouseId = String(link?.testHomeHouseId ?? ensured.id);
  const linkedSourceHouseId = link?.sourceHouseId ? String(link.sourceHouseId) : null;
  const status = String(link?.status ?? (linkedSourceHouseId ? "ready" : "unlinked"));
  const isPinnedToSource = Boolean(
    testHomeHouseId && status === "ready" && linkedSourceHouseId && linkedSourceHouseId === args.selectedSourceHouseId
  );
  return {
    testHomeHouseId,
    linkedSourceHouseId,
    isPinnedToSource,
    status,
    statusMessage: link?.statusMessage ? String(link.statusMessage) : null,
    needsReplace: !isPinnedToSource,
  };
}

export async function loadModelIntelligenceHousesByEmail(email: string) {
  const lookup = await lookupAdminHousesByEmail(email);
  if (!lookup.ok) return lookup;
  return {
    ok: true as const,
    email: lookup.email,
    userId: lookup.userId,
    houses: lookup.houses,
  };
}

export async function resolveModelIntelligenceLabContext(args: {
  email: string;
  houseId: string;
  esiid?: string | null;
}): Promise<
  | { ok: true; context: ModelIntelligenceLabContext; houses: AdminHouseLookupRow[] }
  | { ok: false; error: string; message: string }
> {
  const selection = await resolveAdminHouseSelection({
    email: args.email,
    houseId: args.houseId,
    esiid: args.esiid ?? null,
  });
  if (!selection.ok) {
    return {
      ok: false,
      error: selection.error,
      message:
        selection.error === "email_required"
          ? "Email is required."
          : selection.error === "user_not_found"
            ? "No user found for that email."
            : "House could not be resolved for that email.",
    };
  }

  const sourceContext = await resolveManualGapfillSmtSourceContext({
    userId: selection.userId,
    sourceHouseId: selection.house.id,
    esiid: selection.house.esiid,
    includeDiagnostics: true,
  });

  const labTestHome = await resolveLabTestHomeState({
    ownerUserId: selection.userId,
    selectedSourceHouseId: selection.house.id,
    selectedSourceUserId: selection.userId,
  });

  const warnings = [...(sourceContext.diagnostics?.warnings ?? [])];
  const actualSourceKind = mapActualSourceKind(sourceContext.actualSourceKind);
  const intervalCount = sourceContext.coverage?.intervalCount ?? 0;
  const dailyCount = sourceContext.coverage?.dailyCount ?? 0;
  const sourceTruthAvailable =
    sourceContext.status === "available" && actualSourceKind !== "none" && actualSourceKind !== "ambiguous";
  const profileOnlyHouse = !sourceTruthAvailable && dailyCount === 0 && intervalCount === 0;

  if (profileOnlyHouse) {
    warnings.push("Selected house appears profile-only or has no actual usage truth.");
  }
  if (labTestHome.needsReplace) {
    warnings.push("Lab test home is not pinned to the selected source house; masked/manual/new-build runs will be unavailable.");
  }

  const houseRow = await prisma.houseAddress
    .findFirst({
      where: { id: selection.house.id, archivedAt: null },
      select: { addressLine1: true, addressCity: true, addressState: true, esiid: true },
    })
    .catch(() => null);

  const addressLabel = [houseRow?.addressLine1, houseRow?.addressCity, houseRow?.addressState]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");

  const lookup = await lookupAdminHousesByEmail(selection.email);

  return {
    ok: true,
    houses: lookup.ok ? lookup.houses : [selection.house],
    context: {
      email: selection.email,
      userId: selection.userId,
      sourceHouseId: selection.house.id,
      esiid: selection.house.esiid,
      addressLabel: addressLabel || selection.house.label,
      committedUsageSource: sourceContext.committedUsageSource ?? null,
      actualSourceKind,
      actualContextHouseId: sourceContext.onePathUpstream.actualContextHouseId ?? selection.house.id,
      sourceTruthAvailable,
      profileOnlyHouse,
      coverageStart: sourceContext.coverage?.coverageStart ?? null,
      coverageEnd: sourceContext.coverage?.coverageEnd ?? null,
      dailyCount,
      intervalCount,
      annualTotalKwh: sourceContext.actualData?.annualTotal ?? null,
      intervalFingerprint: sourceContext.fingerprints?.intervalFingerprint ?? null,
      greenButtonAvailable: Boolean(sourceContext.alternatives?.greenButton?.intervalsCount),
      smtIntervalTruthAvailable:
        Boolean(sourceContext.alternatives?.smt?.intervalsCount) ||
        (sourceContext.actualSourceKind === "SMT" && intervalCount > 0),
      labTestHome: {
        testHomeHouseId: labTestHome.testHomeHouseId,
        linkedSourceHouseId: labTestHome.linkedSourceHouseId,
        isPinnedToSource: labTestHome.isPinnedToSource,
        status: labTestHome.status,
        statusMessage: labTestHome.statusMessage,
        needsReplace: labTestHome.needsReplace,
      },
      warnings,
    },
  };
}
