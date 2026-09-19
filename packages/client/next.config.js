const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN || 'http://localhost:5461'

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  // Next's dev/prod server sends no CORS headers by default, so the admin
  // cockpit's cross-origin health probe (a same-page GET from :5461) was
  // blocked by the browser before it ever completed, reporting this service
  // as OFFLINE even while it was actually serving requests fine.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: ADMIN_ORIGIN }],
      },
    ]
  },
}

module.exports = nextConfig
