import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8787/api/:path*",
      },
      {
        source: "/admin/:path*",
        destination: "http://127.0.0.1:8787/admin/:path*",
      },
    ];
  },
};

export default nextConfig;