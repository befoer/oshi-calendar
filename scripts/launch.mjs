import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  statSync,
  readdirSync,
  openSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(workspace);
const port = Number(process.env.HUIQI_PORT || 4173),
  url = `http://127.0.0.1:${port}`;
const npm = (args) => {
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", `npm ${args}`], {
    cwd: workspace,
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`npm ${args} failed`);
};
const newest = (path) =>
  existsSync(path)
    ? statSync(path).isDirectory()
      ? Math.max(
          statSync(path).mtimeMs,
          ...readdirSync(path).map((name) => newest(join(path, name))),
        )
      : statSync(path).mtimeMs
    : 0;
try {
  const serverVersion = createHash("sha256")
    .update(readFileSync("scripts/serve.mjs"))
    .update(readFileSync("scripts/web-tools.mjs"))
    .update(readFileSync("scripts/network.mjs"))
    .digest("hex");
  const health = async () => {
    try {
      const r = await fetch(url + "/__huiqi_health", {
        signal: AbortSignal.timeout(1200),
      });
      if (r.headers.get("X-Huiqi-App") === "creation-calendar") {
        const info = await r.json();
        return info.root !== resolve("dist")
          ? "other"
          : info.serverVersion === serverVersion
            ? "app"
            : "stale";
      }
      return "other";
    } catch {
      return "free";
    }
  };
  if (
    ["vite", "cheerio", "undici"].some(
      (name) => !existsSync(`node_modules/${name}`),
    )
  ) {
    console.log("Installing dependencies...");
    npm("install");
  }
  const source = Math.max(
    ...[
      "src",
      "public",
      "index.html",
      "vite.config.ts",
      "package.json",
      "package-lock.json",
    ].map(newest),
  );
  if (
    !existsSync("dist/index.html") ||
    source > statSync("dist/index.html").mtimeMs
  ) {
    console.log("Building Huiqi...");
    npm("run build");
  }
  let state = await health();
  if (state === "stale") {
    // Upgrade only the server already verified as this workspace, never another app.
    const restart = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
      $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $env:HUIQI_RESTART_PORT -State Listen -ErrorAction Stop | Select-Object -First 1
      $serverProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $listener.OwningProcess)
      if ($serverProcess.ExecutablePath -ne $env:HUIQI_RESTART_NODE -or $serverProcess.CommandLine -notmatch 'scripts[/\\\\]serve\\.mjs') { throw 'Cannot verify workspace server process' }
      Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
    `,
      ],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          HUIQI_RESTART_PORT: String(port),
          HUIQI_RESTART_NODE: process.execPath,
        },
      },
    );
    if (restart.error || restart.status !== 0)
      throw new Error(
        `Unable to upgrade the local server: ${restart.error?.message || restart.stderr}`,
      );
    state = "free";
  }
  if (state === "other")
    throw new Error(
      `Port ${port} is occupied by another application. Close that application and launch again; the address stays fixed to preserve your data.`,
    );
  if (state === "free") {
    const out = openSync(resolve("huiqi-server.log"), "a");
    const child = spawn(process.execPath, ["scripts/serve.mjs"], {
      cwd: workspace,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    child.unref();
    closeSync(out);
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 50));
      state = await health();
      if (state === "app") break;
    }
    if (state !== "app")
      throw new Error("Server did not start. Check huiqi-server.log.");
  }
  if (process.env.HUIQI_NO_OPEN !== "1") {
    const buildId = JSON.parse(readFileSync("dist/build.json", "utf8")).buildId;
    const launchURL = `${url}/?__huiqi_launch=${encodeURIComponent(buildId)}`;
    // rundll32 hands the URL to the default browser directly; a PowerShell process
    // costs ~1.5 s. It never reports failure, so PowerShell stays as the fallback.
    let browser = spawnSync(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", launchURL],
      { windowsHide: true, encoding: "utf8", timeout: 15000 },
    );
    if (browser.error)
      browser = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Start-Process -FilePath '${launchURL}' -ErrorAction Stop`,
        ],
        { windowsHide: true, encoding: "utf8", timeout: 15000 },
      );
    if (browser.error || browser.status !== 0)
      throw new Error(
        `The calendar is running at ${url}, but the browser could not open. Open this address manually. ${browser.error?.message || browser.stderr?.trim() || "Check the default browser in Windows Settings."}`,
      );
  }
  console.log(`Huiqi ready: ${url}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
