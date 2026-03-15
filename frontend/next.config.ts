import type { NextConfig } from "next";
import os from "os";

function getLocalNetworkIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getLocalNetworkIPs(),
  // Rewrites removed: /api/* is now proxied via src/app/api/[...path]/route.ts
  // which pipes response.body (ReadableStream) directly to the browser — no buffering.
  // rewrites() buffered the entire SSE response before forwarding, breaking LLM streaming.
  // Production uses vercel.json external rewrites at the CDN layer (unchanged).
};

export default nextConfig;
