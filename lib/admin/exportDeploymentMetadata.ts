import "server-only";
import { execSync } from "node:child_process";
import type { ExportDeploymentMetadata } from "@/lib/admin/aiTuningBundleHelpers";

function readGitCommitSha(): string | null {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

function readGitCommitRef(): string | null {
  try {
    const ref = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    return ref || null;
  } catch {
    return null;
  }
}

function readWorkingTreeDirty(): boolean | null {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    return status.length > 0;
  } catch {
    return null;
  }
}

export function resolveExportDeploymentMetadata(): ExportDeploymentMetadata {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null;
  const vercelRef = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ?? null;
  if (vercelSha) {
    return {
      gitCommitSha: vercelSha,
      gitCommitRef: vercelRef,
      deployedAt: new Date().toISOString(),
      workingTreeDirty: false,
      metadataSource: "vercel_env",
    };
  }

  const localSha = readGitCommitSha();
  if (localSha) {
    return {
      gitCommitSha: localSha,
      gitCommitRef: readGitCommitRef(),
      deployedAt: new Date().toISOString(),
      workingTreeDirty: readWorkingTreeDirty(),
      metadataSource: "local_git",
    };
  }

  return {
    gitCommitSha: null,
    gitCommitRef: null,
    deployedAt: new Date().toISOString(),
    workingTreeDirty: null,
    metadataSource: "unknown",
  };
}
