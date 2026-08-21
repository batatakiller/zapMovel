import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!target) return [];
    return [
      {
        source: "/db/:path*",
        destination: `${target.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
};

export default nextConfig;
