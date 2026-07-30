import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Нужно для тонкого Docker-образа: .next/standalone с собственным server.js.
  output: 'standalone',
  // pg тянет нативные опциональные зависимости — не бандлим его.
  serverExternalPackages: ['pg'],
}

export default nextConfig
