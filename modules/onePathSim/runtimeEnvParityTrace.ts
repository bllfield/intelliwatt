function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function buildRuntimeEnvParityTrace(args: {
  environmentVisibility?: Record<string, unknown> | null;
}) {
  const environmentVisibility = asRecord(args.environmentVisibility);
  const homeDetails = asRecord(environmentVisibility.homeDetails);
  const appliances = asRecord(environmentVisibility.appliances);
  const usage = asRecord(environmentVisibility.usage);

  const routeRuntime = {
    userUsage: {
      route: "app/api/user/usage/route.ts",
      runtime: "nodejs",
      dynamic: "force-dynamic",
      envReadTiming: "request_time",
      dbOwners: {
        homeDetails: "lib/db/homeDetailsClient.ts -> @prisma/home-details-client",
        appliances: "lib/db/appliancesClient.ts -> @prisma/appliances-client",
        usage: "lib/db/usageClient.ts -> .prisma/usage-client",
      },
    },
    onePathAdmin: {
      route: "app/api/admin/tools/one-path-sim/route.ts",
      runtime: "nodejs",
      dynamic: "force-dynamic",
      envReadTiming: "request_time",
      dbOwners: {
        homeDetails: "lib/db/homeDetailsClient.ts -> @prisma/home-details-client",
        appliances: "lib/db/appliancesClient.ts -> @prisma/appliances-client",
        usage: "lib/db/usageClient.ts -> .prisma/usage-client",
      },
    },
  } as const;

  const dbClientInitTiming = {
    homeDetails: "module_import_time",
    appliances: "module_import_time",
    usage: "module_import_time",
  } as const;

  const routeRuntimeParity =
    routeRuntime.userUsage.runtime === routeRuntime.onePathAdmin.runtime &&
    routeRuntime.userUsage.dynamic === routeRuntime.onePathAdmin.dynamic &&
    routeRuntime.userUsage.envReadTiming === routeRuntime.onePathAdmin.envReadTiming;

  const dbOwnerParity = {
    homeDetails: routeRuntime.userUsage.dbOwners.homeDetails === routeRuntime.onePathAdmin.dbOwners.homeDetails,
    appliances: routeRuntime.userUsage.dbOwners.appliances === routeRuntime.onePathAdmin.dbOwners.appliances,
    usage: routeRuntime.userUsage.dbOwners.usage === routeRuntime.onePathAdmin.dbOwners.usage,
  };

  const envVisibility = {
    homeDetails: Boolean(homeDetails.envVarPresent),
    appliances: Boolean(appliances.envVarPresent),
    usage: Boolean(usage.envVarPresent),
  };

  const parityStatus =
    !envVisibility.homeDetails || !envVisibility.appliances
      ? "local_env_not_populated"
      : routeRuntimeParity && dbOwnerParity.homeDetails && dbOwnerParity.appliances && dbOwnerParity.usage
        ? "runtime_env_parity_ok"
        : "runtime_env_parity_mismatch";

  return {
    routeRuntime,
    routeRuntimeParity,
    envVisibility,
    envVarNames: {
      homeDetails: String(homeDetails.envVarName ?? "HOME_DETAILS_DATABASE_URL"),
      appliances: String(appliances.envVarName ?? "APPLIANCES_DATABASE_URL"),
      usage: String(usage.envVarName ?? "USAGE_DATABASE_URL"),
    },
    dbOwners: {
      homeDetails: String(homeDetails.owner ?? routeRuntime.onePathAdmin.dbOwners.homeDetails),
      appliances: String(appliances.owner ?? routeRuntime.onePathAdmin.dbOwners.appliances),
      usage: String(usage.owner ?? routeRuntime.onePathAdmin.dbOwners.usage),
    },
    dbOwnerParity,
    dbClientInitTiming,
    parityStatus,
  };
}
