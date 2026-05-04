/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel handles deployment — `standalone` was for Docker
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
}

export default nextConfig
