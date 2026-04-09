import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("home-details Prisma bundling wiring", () => {
  it("keeps the Linux engine target and generates home-details under node_modules", () => {
    const schema = readRepoFile("prisma/home-details/schema.prisma");

    expect(schema).toContain('binaryTargets = ["native", "rhel-openssl-3.0.x"]');
    expect(schema).toContain('output        = "../../node_modules/@prisma/home-details-client"');
  });

  it("uses an App Router API tracing rule for transitive home-details Prisma consumers", () => {
    const nextConfig = readRepoFile("next.config.js");

    expect(nextConfig).toContain('"./.prisma/**/*"');
    expect(nextConfig).toContain('"./prisma/**/*"');
    expect(nextConfig).toContain('"./node_modules/@prisma/home-details-client/**/*"');
    expect(nextConfig).toContain('"/api/(.*)": tracedPrismaAssets');
    expect(nextConfig).toContain("transitively load the custom Prisma client");
    expect(nextConfig).not.toContain('"/app/(.*)"');
    expect(nextConfig).not.toContain('"/app/api/(.*)"');
  });

  it("imports the generated node_modules client and keeps the tracing guardrail", () => {
    const nextConfig = readRepoFile("next.config.js");
    const clientSource = readRepoFile("lib/db/homeDetailsClient.ts");

    expect(clientSource).toContain('from "@prisma/home-details-client"');
    expect(nextConfig).toContain('serverComponentsExternalPackages: ["@prisma/client", "@prisma/home-details-client"]');
    expect(nextConfig).toContain("node_modules/@prisma/home-details-client");
  });
});
