/**
 * 桌面窗口与本机资料服务（127.0.0.1:36524）。安装版使用固定用户目录，
 * 便携版和文件夹版沿用 exe 旁边的「推日数据」。
 */
import { app, BrowserWindow, dialog, ipcMain, net, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkForUpdate,
  createUpdateChecker,
  RELEASES_PAGE,
} from "./updates.mjs";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { createInstalledUpdates } from "./installed-updates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const port = 36524;
const origin = `http://127.0.0.1:${port}`;
// 允许在应用内以子窗口打开的站点：次元属性需要 window.opener 才能和推日互传角色
const childOrigins = new Set([origin, "https://befoer.github.io"]);

// 便携版 exe 运行时 PORTABLE_EXECUTABLE_DIR 指向 exe 所在文件夹；开发运行时放在项目里
const dataRoot = app.isPackaged
  ? process.env.PORTABLE_EXECUTABLE_DIR || dirname(app.getPath("exe"))
  : join(here, "..");
const installed =
  app.isPackaged &&
  !process.env.PORTABLE_EXECUTABLE_DIR &&
  existsSync(join(dirname(app.getPath("exe")), "Uninstall 推日.exe"));
app.setPath(
  "userData",
  installed
    ? join(app.getPath("appData"), "OshiCalendar")
    : join(dataRoot, app.isPackaged ? "推日数据" : ".electron-data"),
);

if (!app.requestSingleInstanceLock()) app.quit();

async function health() {
  try {
    const response = await fetch(`${origin}/__huiqi_health`, {
      signal: AbortSignal.timeout(1200),
    });
    return response.headers.get("X-Huiqi-App") === "creation-calendar"
      ? "huiqi"
      : "other";
  } catch {
    return "free";
  }
}

async function startServer() {
  const state = await health();
  // 已有推日服务（比如用旧启动器开着）就直接用它；被别的程序占用则无法使用固定地址
  if (state === "huiqi") return;
  if (state === "other")
    throw new Error(
      `端口 ${port} 被其他程序占用。推日的数据和次元属性联动都依赖这个固定地址，请关闭占用它的程序后再打开。`,
    );
  process.env.HUIQI_PORT = String(port);
  process.env.HUIQI_ROOT = join(here, "..", "dist");
  const { listening } = await import("../scripts/serve.mjs");
  await listening;
}

function isChild(url) {
  try {
    return childOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

// 所有窗口（包括次元属性子窗口）统一处理：推日和次元属性在应用内打开，其他链接交给系统浏览器
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isChild(url))
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 860,
          autoHideMenuBar: true,
          backgroundColor: "#18181b",
        },
      };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isChild(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
});

let main = null;
function createWindow() {
  main = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: "推日 · 角色创作日历",
    icon: join(here, "..", "scripts", "launcher.ico"),
    backgroundColor: "#f6f5fb",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(here, "..", "electron", "preload.cjs") },
  });
  main.once("ready-to-show", () => main?.show());
  main.on("closed", () => (main = null));
  void main.loadURL(`${origin}/`);
}

// ---------- 在线更新 ----------
// 用 Electron 自己的网络（跟随系统代理）访问 GitHub
let updateChecker;
const updates = installed
  ? createInstalledUpdates(
      electronUpdater.autoUpdater,
      app.getVersion(),
      (state) => {
        if (state.status === "error") updateChecker?.clear();
        if (main && !main.isDestroyed())
          main.webContents.send("desktop:update-state", state);
      },
    )
  : null;
const updateCacheFile = () =>
  join(app.getPath("userData"), "update-check-cache.json");
updateChecker = createUpdateChecker(
  () =>
    updates
      ? updates.check()
      : checkForUpdate(app.getVersion(), (url, init) => net.fetch(url, init)),
  {
    current: app.getVersion(),
    cacheAvailable: !installed,
    readCache: async () =>
      JSON.parse(await readFile(updateCacheFile(), "utf8")),
    writeCache: async (cache) =>
      writeFile(updateCacheFile(), JSON.stringify(cache)),
  },
);
const checkUpdate = (options) =>
  updates && ["downloading", "ready"].includes(updates.snapshot().status)
    ? Promise.resolve(updates.snapshot())
    : updateChecker.check(options);
const settingsFile = () =>
  join(app.getPath("userData"), "desktop-settings.json");
async function readSettings() {
  try {
    return JSON.parse(await readFile(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}
const isDownloadURL = (url) =>
  typeof url === "string" &&
  (url.startsWith(RELEASES_PAGE) ||
    url.startsWith("https://github.com/befoer/oshi-calendar/releases/"));

ipcMain.handle("desktop:version", () => app.getVersion());
ipcMain.handle("desktop:check-update", () => checkUpdate());
ipcMain.handle(
  "desktop:update-state",
  () =>
    updates?.snapshot() ?? {
      status: "idle",
      current: app.getVersion(),
      automatic: false,
    },
);
ipcMain.handle("desktop:download-update", () => updates?.download());
ipcMain.handle("desktop:install-update", async () => {
  if (!main || updates?.snapshot().status !== "ready") return;
  const { response } = await dialog.showMessageBox(main, {
    type: "question",
    title: "重启更新",
    message: "现在重启推日并安装更新？",
    detail: "请先保存正在编辑的内容，角色与设置会保留。",
    buttons: ["重启并安装", "稍后"],
    cancelId: 1,
    defaultId: 0,
  });
  if (response === 0) updates?.install();
});
ipcMain.handle("desktop:open-download", (_event, url) => {
  if (isDownloadURL(url)) void shell.openExternal(url);
});

/** 启动后在后台检查一次；有新版弹窗提示，可选择跳过这个版本。 */
async function remindUpdate() {
  const result = await checkUpdate({ automatic: true });
  if (result.status !== "available" || !main) return;
  const settings = await readSettings();
  if (settings.skipVersion === result.latest) return;
  const { response } = await dialog.showMessageBox(main, {
    type: "info",
    title: "推日有新版本",
    message: `发现新版本 ${result.latest}（当前 ${result.current}）`,
    detail:
      (result.notes ? `${result.notes}\n\n` : "") +
      (installed
        ? "下载完成后，可在设置中重启并安装。角色和设置会自动保留。"
        : "可下载新版安装包。首次改用安装版前，请从设置导出 JSON 备份，安装后导入；以后可在软件内更新。"),
    buttons: [installed ? "下载更新" : "下载新版", "稍后", "跳过这个版本"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) {
    if (updates) void updates.download();
    else void shell.openExternal(result.url || RELEASES_PAGE);
  }
  if (response === 2)
    await writeFile(
      settingsFile(),
      JSON.stringify({ ...settings, skipVersion: result.latest }),
    ).catch(() => {});
}

app.on("second-instance", () => {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
});

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (error) {
    dialog.showErrorBox(
      "推日无法启动",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }
  createWindow();
  setTimeout(() => void remindUpdate().catch(() => {}), 8000);
});

app.on("window-all-closed", () => app.quit());
