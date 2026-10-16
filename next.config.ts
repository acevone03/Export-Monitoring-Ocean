import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  experimental: {
    // Arrastre proof uploads go through server actions; storage.ts caps files at 10 MB.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
