import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";

export const GAPFILL_LAB_TEST_HOME_LABEL = "GAPFILL_CANONICAL_LAB_TEST_HOME";
export const MANUAL_MONTHLY_LAB_TEST_HOME_LABEL = "MANUAL_MONTHLY_LAB_TEST_HOME";

type LabTestHomeLink = {
  ownerUserId: string;
  testHomeHouseId: string;
  sourceUserId: string | null;
  sourceHouseId: string | null;
  status: string;
  statusMessage: string | null;
  lastReplacedAt: Date | null;
};

type NamedLabHomeConfig = {
  label: string;
  addressLine1: string;
  addressCity: string;
  addressState: string;
};

function resolveModel(db: any, modelName: string): any | null {
  const fromDb = db?.[modelName];
  if (fromDb) return fromDb;
  const fromRoot = (prisma as any)?.[modelName];
  return fromRoot ?? null;
}

function getLabLinkModel(): any | null {
  try {
    const model = (usagePrisma as any).gapfillLabTestHomeLink;
    if (!model) return null;
    if (
      typeof model.findUnique !== "function" ||
      typeof model.upsert !== "function" ||
      typeof model.update !== "function"
    ) {
      return null;
    }
    return model;
  } catch {
    return null;
  }
}

export async function getLabTestHomeLink(
  ownerUserId: string
): Promise<LabTestHomeLink | null> {
  const model = getLabLinkModel();
  if (!model) return null;
  const row = await model
    .findUnique({
      where: { ownerUserId },
      select: {
        ownerUserId: true,
        testHomeHouseId: true,
        sourceUserId: true,
        sourceHouseId: true,
        status: true,
        statusMessage: true,
        lastReplacedAt: true,
      },
    })
    .catch(() => null);
  if (!row) return null;
  return row as LabTestHomeLink;
}

export async function ensureGlobalLabTestHomeHouse(
  ownerUserId: string
): Promise<{ id: string; esiid: string | null; label: string }> {
  return ensureNamedLabTestHomeHouse(ownerUserId, {
    label: GAPFILL_LAB_TEST_HOME_LABEL,
    addressLine1: "Gap-Fill Canonical Lab Test Home",
    addressCity: "Lab",
    addressState: "TX",
  });
}

export async function ensureGlobalManualMonthlyLabTestHomeHouse(
  ownerUserId: string
): Promise<{ id: string; esiid: string | null; label: string }> {
  return ensureNamedLabTestHomeHouse(ownerUserId, {
    label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
    addressLine1: "Manual Monthly Lab Test Home",
    addressCity: "Lab",
    addressState: "TX",
  });
}

async function ensureNamedLabTestHomeHouse(
  ownerUserId: string,
  config: NamedLabHomeConfig
): Promise<{ id: string; esiid: string | null; label: string }> {
  const existing = await (prisma as any).houseAddress
    .findFirst({
      where: {
        userId: ownerUserId,
        archivedAt: null,
        label: config.label,
      },
      select: { id: true, esiid: true, label: true },
      orderBy: { updatedAt: "desc" },
    })
    .catch(() => null);
  if (existing?.id) {
    return {
      id: String(existing.id),
      esiid: existing.esiid ? String(existing.esiid) : null,
      label: String(existing.label ?? GAPFILL_LAB_TEST_HOME_LABEL),
    };
  }

  const created = await (prisma as any).houseAddress.create({
    data: {
      userId: ownerUserId,
      addressLine1: config.addressLine1,
      addressCity: config.addressCity,
      addressState: config.addressState,
      addressZip5: "00000",
      addressCountry: "US",
      label: config.label,
      isPrimary: false,
    },
    select: { id: true, esiid: true, label: true },
  });

  return {
    id: String(created.id),
    esiid: created.esiid ? String(created.esiid) : null,
    label: String(created.label ?? GAPFILL_LAB_TEST_HOME_LABEL),
  };
}

async function resetLabHomeMutableState(args: { tx: any; ownerUserId: string; houseId: string }) {
  const usageSimulatorBuildModel = resolveModel(args.tx, "usageSimulatorBuild");
  const usageSimulatorScenarioModel = resolveModel(args.tx, "usageSimulatorScenario");
  const usageSimulatorScenarioEventModel = resolveModel(args.tx, "usageSimulatorScenarioEvent");
  const manualUsageInputModel = resolveModel(args.tx, "manualUsageInput");
  if (!usageSimulatorBuildModel?.deleteMany) throw new Error("usageSimulatorBuild_model_unavailable");
  if (!usageSimulatorScenarioModel?.findMany || !usageSimulatorScenarioModel?.deleteMany) {
    throw new Error("usageSimulatorScenario_model_unavailable");
  }
  if (!usageSimulatorScenarioEventModel?.deleteMany) throw new Error("usageSimulatorScenarioEvent_model_unavailable");
  if (!manualUsageInputModel?.deleteMany) throw new Error("manualUsageInput_model_unavailable");

  await usageSimulatorBuildModel.deleteMany({
    where: { userId: args.ownerUserId, houseId: args.houseId },
  });
  const scenarioRows = await usageSimulatorScenarioModel.findMany({
    where: { userId: args.ownerUserId, houseId: args.houseId },
    select: { id: true },
  });
  const scenarioIds = scenarioRows.map((s: any) => String(s.id));
  if (scenarioIds.length > 0) {
    await usageSimulatorScenarioEventModel.deleteMany({
      where: { scenarioId: { in: scenarioIds } },
    });
    await usageSimulatorScenarioModel.deleteMany({
      where: { id: { in: scenarioIds } },
    });
  }
  await manualUsageInputModel.deleteMany({
    where: { userId: args.ownerUserId, houseId: args.houseId },
  });
}

async function copySourceHouseIdentityToLabHome(args: {
  tx: any;
  labHouseId: string;
  sourceHouse: {
    addressLine1: string | null;
    addressLine2: string | null;
    addressCity: string | null;
    addressState: string | null;
    addressZip5: string | null;
    addressZip4: string | null;
    addressCountry: string | null;
    placeId: string | null;
    lat: number | null;
    lng: number | null;
    addressValidated: boolean | null;
    validationSource: string | null;
    tdspSlug: string | null;
    utilityName: string | null;
    utilityPhone: string | null;
  };
  label: string;
}) {
  const houseAddressModel = resolveModel(args.tx, "houseAddress");
  if (!houseAddressModel?.update) throw new Error("houseAddress_model_unavailable");
  await houseAddressModel.update({
    where: { id: args.labHouseId },
    data: {
      addressLine1: args.sourceHouse.addressLine1,
      addressLine2: args.sourceHouse.addressLine2,
      addressCity: args.sourceHouse.addressCity,
      addressState: args.sourceHouse.addressState,
      addressZip5: args.sourceHouse.addressZip5,
      addressZip4: args.sourceHouse.addressZip4,
      addressCountry: args.sourceHouse.addressCountry,
      placeId: args.sourceHouse.placeId,
      lat: args.sourceHouse.lat,
      lng: args.sourceHouse.lng,
      addressValidated: args.sourceHouse.addressValidated,
      validationSource: args.sourceHouse.validationSource,
      tdspSlug: args.sourceHouse.tdspSlug,
      utilityName: args.sourceHouse.utilityName,
      utilityPhone: args.sourceHouse.utilityPhone,
      label: args.label,
      esiid: null,
    },
  });
}

export async function upsertLabTestHomeLink(args: {
  ownerUserId: string;
  testHomeHouseId: string;
  sourceUserId?: string | null;
  sourceHouseId?: string | null;
  status: "ready" | "replacing" | "profile_syncing" | "failed";
  statusMessage?: string | null;
  lastReplacedAt?: Date | null;
}): Promise<void> {
  const model = getLabLinkModel();
  if (!model) return;
  try {
    await model.upsert({
      where: { ownerUserId: args.ownerUserId },
      create: {
        ownerUserId: args.ownerUserId,
        testHomeHouseId: args.testHomeHouseId,
        sourceUserId: args.sourceUserId ?? null,
        sourceHouseId: args.sourceHouseId ?? null,
        status: args.status,
        statusMessage: args.statusMessage ?? null,
        lastReplacedAt: args.lastReplacedAt ?? null,
      },
      update: {
        testHomeHouseId: args.testHomeHouseId,
        sourceUserId: args.sourceUserId ?? null,
        sourceHouseId: args.sourceHouseId ?? null,
        status: args.status,
        statusMessage: args.statusMessage ?? null,
        lastReplacedAt: args.lastReplacedAt ?? undefined,
      },
    });
  } catch {
    // Table may be unavailable during rollout; replacement logic can proceed without link persistence.
  }
}

async function copyScenariosAndEvents(args: {
  tx: any;
  sourceUserId: string;
  sourceHouseId: string;
  targetUserId: string;
  targetHouseId: string;
}) {
  const usageSimulatorScenarioModel = resolveModel(args.tx, "usageSimulatorScenario");
  const usageSimulatorScenarioEventModel = resolveModel(args.tx, "usageSimulatorScenarioEvent");
  if (!usageSimulatorScenarioModel?.findMany || !usageSimulatorScenarioModel?.create) {
    throw new Error("usageSimulatorScenario_model_unavailable");
  }
  if (!usageSimulatorScenarioEventModel?.findMany || !usageSimulatorScenarioEventModel?.createMany) {
    throw new Error("usageSimulatorScenarioEvent_model_unavailable");
  }
  const sourceScenarios = await usageSimulatorScenarioModel.findMany({
    where: { userId: args.sourceUserId, houseId: args.sourceHouseId, archivedAt: null },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!sourceScenarios.length) return;

  const sourceScenarioIds = sourceScenarios.map((s: any) => String(s.id));
  const sourceEvents = await usageSimulatorScenarioEventModel.findMany({
    where: { scenarioId: { in: sourceScenarioIds } },
    select: { scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true },
    orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }],
  });

  const scenarioIdByOld = new Map<string, string>();
  for (const sourceScenario of sourceScenarios) {
    const created = await usageSimulatorScenarioModel.create({
      data: {
        userId: args.targetUserId,
        houseId: args.targetHouseId,
        name: String(sourceScenario.name),
        archivedAt: sourceScenario.archivedAt ?? null,
      },
      select: { id: true },
    });
    scenarioIdByOld.set(String(sourceScenario.id), String(created.id));
  }

  const eventRows = sourceEvents
    .map((e: any) => {
      const mappedScenarioId = scenarioIdByOld.get(String(e.scenarioId));
      if (!mappedScenarioId) return null;
      return {
        scenarioId: mappedScenarioId,
        effectiveMonth: String(e.effectiveMonth),
        kind: String(e.kind),
        payloadJson: e.payloadJson ?? {},
      };
    })
    .filter(Boolean) as Array<{
    scenarioId: string;
    effectiveMonth: string;
    kind: string;
    payloadJson: unknown;
  }>;
  if (eventRows.length > 0) {
    await usageSimulatorScenarioEventModel.createMany({
      data: eventRows,
    });
  }
}

async function copyManualUsageInput(args: {
  tx: any;
  sourceUserId: string;
  sourceHouseId: string;
  targetUserId: string;
  targetHouseId: string;
}) {
  const manualUsageInputModel = resolveModel(args.tx, "manualUsageInput");
  if (!manualUsageInputModel?.findUnique || !manualUsageInputModel?.upsert) {
    throw new Error("manualUsageInput_model_unavailable");
  }
  const sourceManual = await manualUsageInputModel.findUnique({
    where: { userId_houseId: { userId: args.sourceUserId, houseId: args.sourceHouseId } },
    select: {
      mode: true,
      payload: true,
      anchorEndMonth: true,
      anchorEndDate: true,
      annualEndDate: true,
    },
  });
  if (!sourceManual) return;

  await manualUsageInputModel.upsert({
    where: { userId_houseId: { userId: args.targetUserId, houseId: args.targetHouseId } },
    create: {
      userId: args.targetUserId,
      houseId: args.targetHouseId,
      mode: sourceManual.mode,
      payload: sourceManual.payload,
      anchorEndMonth: sourceManual.anchorEndMonth,
      anchorEndDate: sourceManual.anchorEndDate,
      annualEndDate: sourceManual.annualEndDate,
    },
    update: {
      mode: sourceManual.mode,
      payload: sourceManual.payload,
      anchorEndMonth: sourceManual.anchorEndMonth,
      anchorEndDate: sourceManual.anchorEndDate,
      annualEndDate: sourceManual.annualEndDate,
    },
  });
}

export async function replaceGlobalLabTestHomeFromSource(args: {
  ownerUserId: string;
  sourceUserId: string;
  sourceHouseId: string;
}): Promise<{
  ok: boolean;
  testHomeHouseId?: string;
  sourceHouseId?: string;
  error?: string;
  message?: string;
}> {
  const sourceHouse = await (prisma as any).houseAddress
    .findFirst({
      where: {
        id: args.sourceHouseId,
        userId: args.sourceUserId,
        archivedAt: null,
      },
      select: {
        id: true,
        userId: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        addressZip4: true,
        addressCountry: true,
        placeId: true,
        lat: true,
        lng: true,
        addressValidated: true,
        validationSource: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
        utilityPhone: true,
      },
    })
    .catch(() => null);
  if (!sourceHouse?.id) {
    return { ok: false, error: "source_house_not_found" };
  }

  let testHome: { id: string; esiid: string | null; label: string } | null = null;
  try {
    testHome = await ensureGlobalLabTestHomeHouse(args.ownerUserId);
    await upsertLabTestHomeLink({
      ownerUserId: args.ownerUserId,
      testHomeHouseId: testHome.id,
      sourceUserId: args.sourceUserId,
      sourceHouseId: args.sourceHouseId,
      status: "replacing",
      statusMessage: "Replacing reusable lab test-home data from selected source house.",
    });
    await (prisma as any).$transaction(async (tx: any) => {
      await resetLabHomeMutableState({ tx, ownerUserId: args.ownerUserId, houseId: testHome!.id });
      await copySourceHouseIdentityToLabHome({
        tx,
        labHouseId: testHome!.id,
        sourceHouse,
        label: GAPFILL_LAB_TEST_HOME_LABEL,
      });

      await copyScenariosAndEvents({
        tx,
        sourceUserId: args.sourceUserId,
        sourceHouseId: args.sourceHouseId,
        targetUserId: args.ownerUserId,
        targetHouseId: testHome!.id,
      });
      await copyManualUsageInput({
        tx,
        sourceUserId: args.sourceUserId,
        sourceHouseId: args.sourceHouseId,
        targetUserId: args.ownerUserId,
        targetHouseId: testHome!.id,
      });
    });

    // usage-module records are owned by usagePrisma, so clear them outside the main-db transaction.
    await (usagePrisma as any).pastSimulatedDatasetCache
      ?.deleteMany?.({
        where: { houseId: testHome!.id },
      })
      .catch(() => null);
    await (usagePrisma as any).gapfillCompareRunSnapshot
      ?.deleteMany?.({
        where: { houseId: testHome!.id },
      })
      .catch(() => null);

    await upsertLabTestHomeLink({
      ownerUserId: args.ownerUserId,
      testHomeHouseId: testHome!.id,
      sourceUserId: args.sourceUserId,
      sourceHouseId: args.sourceHouseId,
      status: "profile_syncing",
      statusMessage: "Main DB replacement complete; syncing canonical home/appliance profiles.",
    });

    const [sourceHomeProfile, sourceApplianceProfile] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({
        userId: args.sourceUserId,
        houseId: args.sourceHouseId,
      }),
      getApplianceProfileSimulatedByUserHouse({
        userId: args.sourceUserId,
        houseId: args.sourceHouseId,
      }),
    ]);

    if (sourceHomeProfile) {
      await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
        where: { userId_houseId: { userId: args.ownerUserId, houseId: testHome.id } },
        create: {
          userId: args.ownerUserId,
          houseId: testHome!.id,
          ...sourceHomeProfile,
        },
        update: {
          ...sourceHomeProfile,
        },
      });
    }
    if (sourceApplianceProfile?.appliancesJson) {
      await (appliancesPrisma as any).applianceProfileSimulated.upsert({
        where: { userId_houseId: { userId: args.ownerUserId, houseId: testHome.id } },
        create: {
          userId: args.ownerUserId,
          houseId: testHome!.id,
          appliancesJson: sourceApplianceProfile.appliancesJson,
        },
        update: {
          appliancesJson: sourceApplianceProfile.appliancesJson,
        },
      });
    }

    await (prisma as any).houseDailyWeather
      .deleteMany({
        where: { houseId: testHome.id },
      })
      .catch(() => null);

    await upsertLabTestHomeLink({
      ownerUserId: args.ownerUserId,
      testHomeHouseId: testHome!.id,
      sourceUserId: args.sourceUserId,
      sourceHouseId: args.sourceHouseId,
      status: "ready",
      statusMessage: "Lab test home replaced successfully from selected source.",
      lastReplacedAt: new Date(),
    });

    return {
      ok: true,
      testHomeHouseId: testHome!.id,
      sourceHouseId: args.sourceHouseId,
    };
  } catch (error) {
    if (testHome?.id) {
      await upsertLabTestHomeLink({
        ownerUserId: args.ownerUserId,
        testHomeHouseId: testHome.id,
        sourceUserId: args.sourceUserId,
        sourceHouseId: args.sourceHouseId,
        status: "failed",
        statusMessage: error instanceof Error ? error.message : "replace_lab_test_home_failed",
      });
    }
    return {
      ok: false,
      error: "replace_lab_test_home_failed",
      message: error instanceof Error ? error.message : "replace_lab_test_home_failed",
    };
  }
}

export async function replaceGlobalManualMonthlyLabTestHomeFromSource(args: {
  ownerUserId: string;
  sourceUserId: string;
  sourceHouseId: string;
}): Promise<{
  ok: boolean;
  testHomeHouseId?: string;
  sourceHouseId?: string;
  error?: string;
  message?: string;
}> {
  const sourceHouse = await (prisma as any).houseAddress
    .findFirst({
      where: {
        id: args.sourceHouseId,
        userId: args.sourceUserId,
        archivedAt: null,
      },
      select: {
        id: true,
        userId: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        addressZip4: true,
        addressCountry: true,
        placeId: true,
        lat: true,
        lng: true,
        addressValidated: true,
        validationSource: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
        utilityPhone: true,
      },
    })
    .catch(() => null);
  if (!sourceHouse?.id) {
    return { ok: false, error: "source_house_not_found" };
  }

  let testHome: { id: string; esiid: string | null; label: string } | null = null;
  try {
    testHome = await ensureGlobalManualMonthlyLabTestHomeHouse(args.ownerUserId);
    await (prisma as any).$transaction(async (tx: any) => {
      await resetLabHomeMutableState({ tx, ownerUserId: args.ownerUserId, houseId: testHome!.id });
      await copySourceHouseIdentityToLabHome({
        tx,
        labHouseId: testHome!.id,
        sourceHouse,
        label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
      });
      await copyManualUsageInput({
        tx,
        sourceUserId: args.sourceUserId,
        sourceHouseId: args.sourceHouseId,
        targetUserId: args.ownerUserId,
        targetHouseId: testHome!.id,
      });
    });

    await (usagePrisma as any).pastSimulatedDatasetCache
      ?.deleteMany?.({
        where: { houseId: testHome!.id },
      })
      .catch(() => null);

    const [sourceHomeProfile, sourceApplianceProfile] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({
        userId: args.sourceUserId,
        houseId: args.sourceHouseId,
      }),
      getApplianceProfileSimulatedByUserHouse({
        userId: args.sourceUserId,
        houseId: args.sourceHouseId,
      }),
    ]);

    if (sourceHomeProfile) {
      await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
        where: { userId_houseId: { userId: args.ownerUserId, houseId: testHome.id } },
        create: {
          userId: args.ownerUserId,
          houseId: testHome!.id,
          ...sourceHomeProfile,
        },
        update: {
          ...sourceHomeProfile,
        },
      });
    }
    if (sourceApplianceProfile?.appliancesJson) {
      await (appliancesPrisma as any).applianceProfileSimulated.upsert({
        where: { userId_houseId: { userId: args.ownerUserId, houseId: testHome.id } },
        create: {
          userId: args.ownerUserId,
          houseId: testHome!.id,
          appliancesJson: sourceApplianceProfile.appliancesJson,
        },
        update: {
          appliancesJson: sourceApplianceProfile.appliancesJson,
        },
      });
    }

    await (prisma as any).houseDailyWeather
      .deleteMany({
        where: { houseId: testHome.id },
      })
      .catch(() => null);

    return {
      ok: true,
      testHomeHouseId: testHome!.id,
      sourceHouseId: args.sourceHouseId,
    };
  } catch (error) {
    return {
      ok: false,
      error: "replace_manual_monthly_lab_test_home_failed",
      message: error instanceof Error ? error.message : "replace_manual_monthly_lab_test_home_failed",
    };
  }
}


