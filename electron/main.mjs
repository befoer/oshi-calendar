/**
 * 推日 Electron 便携版：在本进程里启动本机资料服务（固定 127.0.0.1:4173），
 * 用自带窗口打开它。数据（IndexedDB 等）放在 exe 旁边的「推日数据」文件夹，拷走整个文件夹就能带走。
 */
import { app, BrowserWindow, dialog, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
// 允许在应用内以子窗口打开的站点：次元属性需要 window.opener 才能和推日互传角色
const childOrigins = new Set([origin, "https://befoer.github.io"]);

// 便携版 exe 运行时 PORTABLE_EXECUTABLE_DIR 指向 exe 所在文件夹；开发运行时放在项目里
const dataRoot = app.isPackaged
  ? process.env.PORTABLE_EXECUTABLE_DIR || dirname(app.getPath("exe"))
  : join(here, "..");
app.setPath("userData", join(dataRoot, app.isPackaged ? "推日数据" : ".electron-data"));

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
  });
  main.once("ready-to-show", () => main?.show());
  main.on("closed", () => (main = null));
  void main.loadURL(`${origin}/`);
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
});

app.on("window-all-closed", () => app.quit());
