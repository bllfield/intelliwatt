/** @type {import('next').NextConfig} */
const tracedPrismaAssets = ['./.prisma/**/*', './prisma/**/*'];

const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
    outputFileTracingIncludes: {
      '/app/(.*)': tracedPrismaAssets,
      '/app/api/(.*)': tracedPrismaAssets,
      '/app/api/current-plan': tracedPrismaAssets,
      '/app/api/current-plan/(.*)': tracedPrismaAssets,
    },
  },
};

module.exports = nextConfig; 