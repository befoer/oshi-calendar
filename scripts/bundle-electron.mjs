// 把 Electron 主进程和本机资料服务（含 cheerio、undici）打成一个文件，
// 这样便携版不需要带 node_modules，体积只剩 Electron 本身和构建好的页面。
import { build } from "esbuild";

await build({
  entryPoints: ["electron/main.mjs"],
  outfile: "electron-dist/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  minify: true,
  legalComments: "none",
  // 部分依赖仍用 require()：在 ESM 包里补一个 require
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});
console.log("Bundled electron-dist/main.mjs");
