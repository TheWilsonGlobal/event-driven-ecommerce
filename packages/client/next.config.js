const fs = require('fs')
const path = require('path')

/**
 * Only the project URL and the PUBLISHABLE key may reach the browser. They are
 * read from the process env first, then from the repo-root .env, through an
 * explicit allow-list so no other (server-only) variable can ever be exposed
 * by this file.
 */
function readPublicSupabaseConfig() {
  const wanted = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']
  const out = {}
  let file = {}
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8')
    for (const line of text.split(String.fromCharCode(10))) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && wanted.includes(m[1])) file[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // no root .env (e.g. Docker build): rely on process.env
  }
  for (const k of wanted) out[k] = process.env[k] || file[k] || ''
  return out
}
const publicSupabase = readPublicSupabaseConfig()

const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN || 'http://localhost:5461'

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.OUTPUT_STANDALONE === 'true' ? { output: 'standalone' } : {}),
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || publicSupabase.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || publicSupabase.SUPABASE_PUBLISHABLE_KEY,
  },
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
