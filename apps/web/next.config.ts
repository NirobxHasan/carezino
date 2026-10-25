import type { NextConfig } from "next";

/** Where the NestJS API listens. The browser never calls it directly; see rewrites below. */
const API_URL = (process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /* config options here */
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
  // The API is served under this app's origin at /api, so the session cookie is
  // first-party, HttpOnly and SameSite, and no CORS configuration is needed.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  // Plain redirects happen here, before rendering, rather than in pages.
  async redirects() {
    return [
      { source: "/", destination: "/dashboard", permanent: false },
      { source: "/settings", destination: "/settings/center", permanent: false },
      // A plan's reviews are a tab of the plan page (breadcrumbs link here).
      {
        source: "/therapy-plans/:id/reviews",
        destination: "/therapy-plans/:id?tab=reviews",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // These URLs carry one-time tokens; never leak them in a Referer header.
        source: "/(reset-password|invite)",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
