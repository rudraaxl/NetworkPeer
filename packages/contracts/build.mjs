import { build } from "esbuild";

await build({
  entryPoints: ["./src/index.ts"],
  outfile: "./dist/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: [],
});

await build({
  entryPoints: ["./src/index.ts"],
  outfile: "./dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: [],
});
