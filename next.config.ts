import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Needed for a lean Docker image: .next/standalone ships its own server.js.
  output: 'standalone',
  // pg pulls in native optional dependencies, so don't bundle it.
  serverExternalPackages: ['pg'],
}

export default nextConfig
