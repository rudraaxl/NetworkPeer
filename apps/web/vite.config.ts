import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {},
  nitro: {
    preset: "vercel",
    noExternals: true,
  },
});
