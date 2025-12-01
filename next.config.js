/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: [
      '@prisma/client',
      '@prisma/current-plan-client',
      '@prisma/usage-client',
    ],
  },
};

module.exports = nextConfig; 