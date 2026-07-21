import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "..");

const nextConfig: NextConfig = {
  // 仓库路径含中文时 Turbopack 会因 UTF-8 切字崩溃；dev/build 默认走 webpack。
  // turbopack.root 与 outputFileTracingRoot 必须同值，否则 Next 告警并回退到 tracing root。
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        // 大仓 + 中文路径下原生 kqueue 易 EMFILE；轮询更稳。
        poll: 1000,
        aggregateTimeout: 300,
        ignored: [
          "**/.git/**",
          "**/node_modules/**",
          "**/.next/**",
          "**/instances/**",
          "**/evaluation/**",
          "**/ontology/**",
          "**/methods/**",
          "**/workflow/**",
          "**/governance/**",
        ],
      };
    }
    return config;
  },
  outputFileTracingExcludes: {
    "/*": ["next.config.ts", ".next/**/*", "tests/**/*"],
  },
};

export default nextConfig;
