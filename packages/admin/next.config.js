/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    serverComponentsExternalPackages: [
      '@ecommerce/shared-database',
      '@ecommerce/shared-types',
      '@ecommerce/shared-utils',
      'pg',
      'ioredis',
      'redis',
      'mongoose',
      '@prisma/client',
    ],
  },
};

module.exports = nextConfig;
