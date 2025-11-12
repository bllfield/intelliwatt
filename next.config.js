/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

module.exports = nextConfig; 