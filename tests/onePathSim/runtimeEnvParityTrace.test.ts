import { describe, expect, it } from "vitest";
import { buildRuntimeEnvParityTrace } from "@/modules/onePathSim/runtimeEnvParityTrace";

describe("buildRuntimeEnvParityTrace", () => {
  it("surfaces env visibility separately from Brian data truth", () => {
    const trace = buildRuntimeEnvParityTrace({
      environmentVisibility: {
        homeDetails: {
          envVarName: "HOME_DETAILS_DATABASE_URL",
          envVarPresent: false,
          owner: "lib/db/homeDetailsClient.ts -> @prisma/home-details-client",
        },
        appliances: {
          envVarName: "APPLIANCES_DATABASE_URL",
          envVarPresent: false,
          owner: "lib/db/appliancesClient.ts -> @prisma/appliances-client",
        },
        usage: {
          envVarName: "USAGE_DATABASE_URL",
          envVarPresent: false,
          owner: "lib/db/usageClient.ts -> .prisma/usage-client",
        },
      },
    });

    expect(trace.routeRuntime.userUsage.runtime).toBe("nodejs");
    expect(trace.routeRuntime.onePathAdmin.runtime).toBe("nodejs");
    expect(trace.dbClientInitTiming.homeDetails).toBe("module_import_time");
    expect(trace.parityStatus).toBe("local_env_not_populated");
  });

  it("reports runtime parity when both routes share the same env-backed owners", () => {
    const trace = buildRuntimeEnvParityTrace({
      environmentVisibility: {
        homeDetails: {
          envVarName: "HOME_DETAILS_DATABASE_URL",
          envVarPresent: true,
          owner: "lib/db/homeDetailsClient.ts -> @prisma/home-details-client",
        },
        appliances: {
          envVarName: "APPLIANCES_DATABASE_URL",
          envVarPresent: true,
          owner: "lib/db/appliancesClient.ts -> @prisma/appliances-client",
        },
        usage: {
          envVarName: "USAGE_DATABASE_URL",
          envVarPresent: true,
          owner: "lib/db/usageClient.ts -> .prisma/usage-client",
        },
      },
    });

    expect(trace.routeRuntimeParity).toBe(true);
    expect(trace.dbOwnerParity.homeDetails).toBe(true);
    expect(trace.dbOwnerParity.appliances).toBe(true);
    expect(trace.parityStatus).toBe("runtime_env_parity_ok");
  });
});
