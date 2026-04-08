/** @type {import('next').NextConfig} */
const tracedPrismaAssets = ["./.prisma/**/*", "./prisma/**/*"];
const homeDetailsPrismaRouteKeys = [
  "/api/user/home-profile",
  "/api/user/simulator/requirements",
  "/api/admin/simulation-engines",
  "/api/admin/tools/gapfill-lab",
  "/api/admin/tools/gapfill-lab/(.*)",
  "/api/admin/tools/manual-monthly",
  "/api/admin/tools/manual-monthly/(.*)",
  "/api/current-plan",
  "/api/current-plan/(.*)",
];
const outputFileTracingIncludes = Object.fromEntries(
  homeDetailsPrismaRouteKeys.map((routeKey) => [routeKey, tracedPrismaAssets])
);

const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
    // App Router tracing keys must use deployed URL pathnames, not `app/...` filesystem paths.
    // Verify after `next build` by inspecting the matching `.next/server/app/.../*.nft.json`
    // entries for `.prisma/home-details-client/libquery_engine-rhel-openssl-3.0.x.so.node`.
    outputFileTracingIncludes,
  },
};

module.exports = nextConfig; 