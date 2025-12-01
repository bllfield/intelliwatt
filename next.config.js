/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
    outputFileTracingIncludes: {
      '/app/api/current-plan': ['../.prisma/current-plan-client/**/*'],
      '/app/api/current-plan/(.*)': ['../.prisma/current-plan-client/**/*'],
    },
  },
};

module.exports = nextConfig; 