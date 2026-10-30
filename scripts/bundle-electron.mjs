// 把 Electron 主进程和本机资料服务（含 cheerio、undici）打成一个文件，
// 这样便携版不需要带 node_modules，体积只剩 Electron 本身和构建好的页面。
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform === "win32") {
  const compilerRoot = join(process.env.WINDIR, "Microsoft.NET");
  const compiler = ["Framework64", "Framework"]
    .map((arch) => join(compilerRoot, arch, "v4.0.30319", "csc.exe"))
    .find(existsSync);
  if (!compiler)
    throw new Error("Windows .NET Framework compiler was not found");
  mkdirSync("electron-dist", { recursive: true });
  execFileSync(
    compiler,
    [
      "/nologo",
      "/codepage:65001",
      "/target:winexe",
      "/optimize+",
      `/out:${resolve("electron-dist/portable-updater.exe")}`,
      "/reference:System.Windows.Forms.dll",
      resolve("electron/portable-updater.cs"),
    ],
    { stdio: "inherit", windowsHide: true },
  );
}

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
