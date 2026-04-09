export type ManualReadbackTriggerLike = {
  ok?: boolean;
  executionMode?: "inline" | "droplet_async" | string | null;
  readbackPending?: boolean | null;
  canonicalArtifactInputHash?: string | null;
  correlationId?: string | null;
  result?: {
    canonicalArtifactInputHash?: string | null;
  } | null;
} | null | undefined;

export type ManualReadbackPollPlan = {
  shouldPoll: boolean;
  exactArtifactInputHash: string | null;
  requireExactArtifactMatch: boolean;
  correlationId: string | null;
};

export function resolveManualReadbackPollPlan(trigger: ManualReadbackTriggerLike): ManualReadbackPollPlan {
  const exactArtifactInputHash = normalizeNonEmptyString(
    trigger?.canonicalArtifactInputHash ?? trigger?.result?.canonicalArtifactInputHash ?? null
  );
  const shouldPoll =
    trigger?.ok === true &&
    (trigger?.executionMode === "droplet_async" || trigger?.readbackPending === true);
  return {
    shouldPoll,
    exactArtifactInputHash,
    requireExactArtifactMatch: exactArtifactInputHash != null,
    correlationId: normalizeNonEmptyString(trigger?.correlationId ?? null),
  };
}

function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}
