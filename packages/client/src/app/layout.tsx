import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'E-Commerce Microservices Platform',
  description: 'Scalable Microservices E-Commerce Platform built with Next.js 14 and Fastify',
  // icon.svg lives alongside this file; the App Router picks it up by
  // convention, and declaring it here keeps the reference explicit.
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  )
}
