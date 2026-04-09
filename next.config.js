/** @type {import('next').NextConfig} */
const tracedPrismaAssets = [
  "./.prisma/**/*",
  "./prisma/**/*",
  "./node_modules/@prisma/home-details-client/**/*",
];
const outputFileTracingIncludes = {
  // Shared simulator modules import Home Details at module scope, so App Router API handlers
  // can transitively load the custom Prisma client even when the route does not reference it directly.
  "/api/(.*)": tracedPrismaAssets,
};

const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "@prisma/home-details-client"],
    // App Router tracing keys must use deployed URL pathnames, not `app/...` filesystem paths.
    // Shared simulator modules can transitively load Home Details from many API handlers, so
    // we trace all App Router API routes and the generated package that now lives in node_modules.
    outputFileTracingIncludes,
  },
};

module.exports = nextConfig; 