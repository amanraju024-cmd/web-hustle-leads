import { build } from "esbuild";
await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  outfile: "public/app.js",
  logLevel: "info",
});
