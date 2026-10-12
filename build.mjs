// Builds public/: bundles src/main.js into a content-hashed file (so phones can cache it
// forever) and writes public/index.html pointing at it.
import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";

for (const f of readdirSync("public")) if (/^app(-[A-Z0-9]+)?\.js$/i.test(f)) unlinkSync(`public/${f}`);
const result = await build({
  entryPoints: { app: "src/main.js" },
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2020"],
  outdir: "public",
  entryNames: "[name]-[hash]",
  legalComments: "none",
  metafile: true,
  logLevel: "info",
});
const out = Object.keys(result.metafile.outputs).find((f) => /app-.*\.js$/.test(f)).split("/").pop();
const html = readFileSync("src/index.html", "utf8").replace('src="app.js"', `src="${out}"`)
  .replace("<!--PRELOAD-->", `<link rel="modulepreload" href="${out}">`);
if (!html.includes(out)) throw new Error("index.html template is missing the app.js script tag");
writeFileSync("public/index.html", html);
console.log("wrote public/index.html ->", out);
