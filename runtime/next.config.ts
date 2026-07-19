import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["next.config.ts", ".next/**/*", "tests/**/*"],
  },
};

export default nextConfig;
