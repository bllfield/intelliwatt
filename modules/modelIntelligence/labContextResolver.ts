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
  /** Admin One Path lab owner — must match resolveOnePathSimOwnerUserId(), not the looked-up customer userId. */
  ownerUserId: string;
}): Promise<
  | { ok: true; context: ModelIntelligenceLabContext; houses: AdminHouseLookupRow[] }
  | { ok: false; error: string; message: string }
> {
  const lookup = await lookupAdminHousesByEmail(args.email);
  if (!lookup.ok) {
    return {
      ok: false,
      error: lookup.error,
      message:
        lookup.error === "email_required"
          ? "Email is required."
          : "No user found for that email.",
    };
  }

  const selectedHouse =
    (await resolveAdminHouseSelection({
      email: lookup.email,
      houseId: args.houseId,
      esiid: args.esiid ?? null,
    })) ?? null;
  if (!selectedHouse || !lookup.houses.some((house) => house.id === selectedHouse.id)) {
    return {
      ok: false,
      error: "house_not_found",
      message: "House could not be resolved for that email.",
    };
  }

  const sourceContext = await resolveManualGapfillSmtSourceContext({
    userId: lookup.userId,
    sourceHouseId: selectedHouse.id,
    esiid: selectedHouse.esiid,
    includeDiagnostics: true,
  });

  const labTestHome = await resolveLabTestHomeState({
    ownerUserId: args.ownerUserId,
    selectedSourceHouseId: selectedHouse.id,
    selectedSourceUserId: lookup.userId,
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
      where: { id: selectedHouse.id, archivedAt: null },
      select: { addressLine1: true, addressCity: true, addressState: true, esiid: true },
    })
    .catch(() => null);

  const addressLabel = [houseRow?.addressLine1, houseRow?.addressCity, houseRow?.addressState]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");

  return {
    ok: true,
    houses: lookup.houses,
    context: {
      email: lookup.email,
      userId: lookup.userId,
      sourceHouseId: selectedHouse.id,
      esiid: selectedHouse.esiid,
      addressLabel: addressLabel || selectedHouse.label,
      committedUsageSource: sourceContext.committedUsageSource ?? null,
      actualSourceKind,
      actualContextHouseId: sourceContext.onePathUpstream.actualContextHouseId ?? selectedHouse.id,
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
