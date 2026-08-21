import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. Without this, Turbopack walks up and finds an
    // unrelated package-lock.json in the home directory and warns about it.
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
