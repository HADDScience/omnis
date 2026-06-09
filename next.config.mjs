import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false, // 좌측하단 Next.js 개발 툴박스 숨김
  typescript: {
    ignoreBuildErrors: false,
  },
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
