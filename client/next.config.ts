import type { NextConfig } from "next";

/**
 * Optional same-origin API proxy. When API_PROXY_TARGET is set (e.g. the
 * Render URL) and NEXT_PUBLIC_API_URL is "/api/v1", the browser only ever
 * talks to this app's own origin, so the session cookie is first-party.
 * Safari and other browsers that block third-party cookies keep working.
 * Without it, the client calls the API directly, cross-site, which needs
 * SameSite=None; Secure cookies (see DEPLOYMENT.md).
 */
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The Playwright suite builds into its own folder so it never disturbs a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return apiProxyTarget ? [{ source: "/api/v1/:path*", destination: `${apiProxyTarget}/api/v1/:path*` }] : [];
  },
};

export default nextConfig;
