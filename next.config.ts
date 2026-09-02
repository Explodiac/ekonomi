import type { NextConfig } from "next";

// Not: Next 16 NextConfig tipinde artık `eslint` anahtarı yok (build sırasında
// ESLint çalıştırılmıyor); eski `eslint.ignoreDuringBuilds` kaldırıldı.
const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
