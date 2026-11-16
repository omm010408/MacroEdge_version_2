import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.FIGMA ? "standalone" : undefined,
  outputFileTracingRoot: path.resolve(__dirname),
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        buffer: false,
      };
    }
    return config;
  },
};

export default nextConfig;
