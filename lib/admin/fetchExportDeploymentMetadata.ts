import type { ExportDeploymentMetadata } from "@/lib/admin/aiTuningBundleHelpers";

export async function fetchExportDeploymentMetadata(): Promise<ExportDeploymentMetadata | null> {
  try {
    const res = await fetch("/api/admin/tools/export-metadata", { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json?.ok) return null;
    return {
      gitCommitSha: typeof json.gitCommitSha === "string" ? json.gitCommitSha : null,
      gitCommitRef: typeof json.gitCommitRef === "string" ? json.gitCommitRef : null,
      deployedAt: typeof json.deployedAt === "string" ? json.deployedAt : null,
      workingTreeDirty: typeof json.workingTreeDirty === "boolean" ? json.workingTreeDirty : null,
      metadataSource:
        json.metadataSource === "vercel_env" || json.metadataSource === "local_git" || json.metadataSource === "unknown"
          ? json.metadataSource
          : "unknown",
    };
  } catch {
    return null;
  }
}
