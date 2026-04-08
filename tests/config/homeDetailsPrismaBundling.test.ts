import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("home-details Prisma bundling wiring", () => {
  it("keeps the custom home-details client output path and Linux engine target", () => {
    const schema = readRepoFile("prisma/home-details/schema.prisma");

    expect(schema).toContain('binaryTargets = ["native", "rhel-openssl-3.0.x"]');
    expect(schema).toContain('output        = "../../.prisma/home-details-client"');
  });

  it("uses App Router URL pathname tracing keys for routes that touch home-details Prisma", () => {
    const nextConfig = readRepoFile("next.config.js");

    expect(nextConfig).toContain('const tracedPrismaAssets = ["./.prisma/**/*", "./prisma/**/*"]');
    expect(nextConfig).toContain('"/api/user/home-profile"');
    expect(nextConfig).toContain('"/api/user/simulator/requirements"');
    expect(nextConfig).toContain('"/api/admin/simulation-engines"');
    expect(nextConfig).toContain('"/api/admin/tools/gapfill-lab"');
    expect(nextConfig).toContain('"/api/admin/tools/gapfill-lab/(.*)"');
    expect(nextConfig).toContain('"/api/admin/tools/manual-monthly"');
    expect(nextConfig).toContain('"/api/admin/tools/manual-monthly/(.*)"');
    expect(nextConfig).toContain('"/api/current-plan"');
    expect(nextConfig).toContain('"/api/current-plan/(.*)"');
    expect(nextConfig).not.toContain('"/app/(.*)"');
    expect(nextConfig).not.toContain('"/app/api/(.*)"');
  });

  it("imports the custom client from .prisma and documents nft verification", () => {
    const nextConfig = readRepoFile("next.config.js");
    const clientSource = readRepoFile("lib/db/homeDetailsClient.ts");

    expect(clientSource).toContain('from "../../.prisma/home-details-client"');
    expect(nextConfig).toContain(".nft.json");
    expect(nextConfig).toContain(".prisma/home-details-client/libquery_engine-rhel-openssl-3.0.x.so.node");
  });
});
