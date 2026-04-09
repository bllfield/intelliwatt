/** @type {import('next').NextConfig} */
const tracedPrismaAssets = [
  "./.prisma/**/*",
  "./prisma/**/*",
  "./node_modules/@prisma/appliances-client/**/*",
  "./node_modules/@prisma/home-details-client/**/*",
];
const outputFileTracingIncludes = {
  // Shared modules can transitively load custom Prisma clients at module scope, so App Router API
  // handlers need one URL-pathname rule that covers live server routes without relying on `/app/...`.
  "/api/(.*)": tracedPrismaAssets,
};

const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "@prisma/appliances-client",
      "@prisma/home-details-client",
    ],
    // App Router tracing keys must use deployed URL pathnames, not `app/...` filesystem paths.
    // Route-wide API tracing keeps `.prisma/...-client` packages covered, while clients that have
    // proven brittle in production are generated into `node_modules/@prisma/*-client`.
    outputFileTracingIncludes,
  },
};

module.exports = nextConfig; 