import type { OnePathUserSiteParityLock } from "@/lib/usage/onePathPastUserSiteParityLock";

export const WORKSPACE_PAST_SCENARIO_NAME = "Past (Corrected)";

export type OnePathPastParitySyncResult =
  | {
      ok: true;
      parity: OnePathUserSiteParityLock;
      copiedFromSourceCache: boolean;
      sourceInputHash: string;
      /** mirror = copied persisted user-site build; seed = synthesized from source DB */
      syncKind?: "mirror" | "seed";
    }
  | { ok: false; code: string; message: string };
