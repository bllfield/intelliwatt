import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("custom Prisma client bundling wiring", () => {
  it("keeps all custom Prisma clients on the Linux engine target with the expected output paths", () => {
    const schemas = {
      appliances: readRepoFile("prisma/appliances/schema.prisma"),
      currentPlan: readRepoFile("prisma/current-plan/schema.prisma"),
      homeDetails: readRepoFile("prisma/home-details/schema.prisma"),
      referrals: readRepoFile("prisma/referrals/schema.prisma"),
      upgrades: readRepoFile("prisma/upgrades/schema.prisma"),
      usage: readRepoFile("prisma/usage/schema.prisma"),
      wattbuyOffers: readRepoFile("prisma/wattbuy-offers/schema.prisma"),
    };

    for (const schema of Object.values(schemas)) {
      expect(schema).toContain('binaryTargets = ["native", "rhel-openssl-3.0.x"]');
    }
    expect(schemas.appliances).toContain('output        = "../../node_modules/@prisma/appliances-client"');
    expect(schemas.homeDetails).toContain('output        = "../../node_modules/@prisma/home-details-client"');
    expect(schemas.currentPlan).toContain('output        = "../../.prisma/current-plan-client"');
    expect(schemas.referrals).toContain('output        = "../../.prisma/referrals-client"');
    expect(schemas.upgrades).toContain('output        = "../../.prisma/upgrades-client"');
    expect(schemas.usage).toContain('output        = "../../.prisma/usage-client"');
    expect(schemas.wattbuyOffers).toContain('output        = "../../.prisma/wattbuy-offers-client"');
  });

  it("uses real App Router URL pathname tracing keys and covers both .prisma and hardened node_modules clients", () => {
    const nextConfig = readRepoFile("next.config.js");

    expect(nextConfig).toContain('"./.prisma/**/*"');
    expect(nextConfig).toContain('"./prisma/**/*"');
    expect(nextConfig).toContain('"./node_modules/@prisma/appliances-client/**/*"');
    expect(nextConfig).toContain('"./node_modules/@prisma/home-details-client/**/*"');
    expect(nextConfig).toContain('"/api/(.*)": tracedPrismaAssets');
    expect(nextConfig).toContain("Route-wide API tracing");
    expect(nextConfig).not.toContain('"/app/(.*)"');
    expect(nextConfig).not.toContain('"/app/api/(.*)"');
  });

  it("imports hardened node_modules clients and keeps external package coverage explicit", () => {
    const nextConfig = readRepoFile("next.config.js");
    const appliancesClientSource = readRepoFile("lib/db/appliancesClient.ts");
    const homeDetailsClientSource = readRepoFile("lib/db/homeDetailsClient.ts");

    expect(appliancesClientSource).toContain('from "@prisma/appliances-client"');
    expect(homeDetailsClientSource).toContain('from "@prisma/home-details-client"');
    expect(nextConfig).toContain("@prisma/appliances-client");
    expect(nextConfig).toContain("@prisma/home-details-client");
  });
});
