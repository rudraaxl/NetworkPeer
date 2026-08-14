import { defineConfig } from "@lovable.dev/vite-tanstack-config";

if (process.argv.includes("build")) {
  process.env.NODE_ENV = "production";
}

export default defineConfig({
  tanstackStart: {},
  nitro: {
    preset: "vercel",
    noExternals: true,
  } as { preset?: string; noExternals?: boolean },
});
