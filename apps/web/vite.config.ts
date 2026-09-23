import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// NP-18: the API origin was hardcoded to a staging load balancer in five files,
// over plaintext HTTP. It is now one env-driven value that defaults to a local
// API, so `npm run dev` talks to the backend on this machine unless told
// otherwise. Set API_PROXY_TARGET to point a local web build at a deployed API.
const apiOrigin = (process.env.API_PROXY_TARGET || "http://127.0.0.1:3000").replace(/\/$/, "");

if (process.argv.includes("build")) {
  process.env.NODE_ENV = "production";
}

export default defineConfig({
  // The app has no server functions and no route loaders -- every screen
  // fetches from the browser -- so it ships as static files to S3 behind
  // CloudFront. CloudFront forwards /api/v1/* to the API, which keeps the site
  // same-origin with it (no CORS) and gives both HTTPS without owning a domain.
  tanstackStart: {
    spa: { enabled: true },
  },
  server: {
    port: 8080,
    proxy: {
      "/api/v1": {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  // nitro is the server build. This app has no server functions and no route
  // loaders, so there is nothing for a server to do: skipping nitro emits a
  // plain client bundle that S3 can serve directly.
  nitro: false,
} as any);
