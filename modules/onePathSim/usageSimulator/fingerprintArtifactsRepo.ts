/**
 * Usage-DB persistence for WholeHomeFingerprint / UsageFingerprint rows (Phase 2a).
 * Cross-DB references from main `UsageSimulatorBuild` use opaque string ids only (no Prisma FK).
 */

import { usagePrisma } from "@/lib/db/usageClient";
import type { Prisma, SimulatorFingerprintStatus } from "@/.prisma/usage-client";

export type FingerprintArtifactUpsertArgs = {
  houseId: string;
  status: SimulatorFingerprintStatus;
  algorithmVersion: string;
  sourceHash: string;
  staleReason?: string | null;
  builtAt?: Date | null;
  payloadJson: Prisma.InputJsonValue;
};

export async function upsertWholeHomeFingerprintArtifact(args: FingerprintArtifactUpsertArgs) {
  const { houseId, status, algorithmVersion, sourceHash, staleReason, builtAt, payloadJson } = args;
  return usagePrisma.wholeHomeFingerprint.upsert({
    where: { houseId },
    create: {
      houseId,
      status,
      algorithmVersion,
      sourceHash,
      staleReason: staleReason ?? null,
      builtAt: builtAt ?? null,
      payloadJson: payloadJson as Prisma.InputJsonValue,
    },
    update: {
      status,
      algorithmVersion,
      sourceHash,
      staleReason: staleReason ?? null,
      builtAt: builtAt ?? null,
      payloadJson: payloadJson as Prisma.InputJsonValue,
    },
  });
}

export async function upsertUsageFingerprintArtifact(args: FingerprintArtifactUpsertArgs) {
  const { houseId, status, algorithmVersion, sourceHash, staleReason, builtAt, payloadJson } = args;
  return usagePrisma.usageFingerprint.upsert({
    where: { houseId },
    create: {
      houseId,
      status,
      algorithmVersion,
      sourceHash,
      staleReason: staleReason ?? null,
      builtAt: builtAt ?? null,
      payloadJson: payloadJson as Prisma.InputJsonValue,
    },
    update: {
      status,
      algorithmVersion,
      sourceHash,
      staleReason: staleReason ?? null,
      builtAt: builtAt ?? null,
      payloadJson: payloadJson as Prisma.InputJsonValue,
    },
  });
}

export async function getLatestWholeHomeFingerprintByHouseId(houseId: string) {
  return usagePrisma.wholeHomeFingerprint.findUnique({ where: { houseId } });
}

export async function getLatestUsageFingerprintByHouseId(houseId: string) {
  return usagePrisma.usageFingerprint.findUnique({ where: { houseId } });
}

