import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";

const runFile = promisify(execFile);
let cachedWindows = null,
  refreshAt = 0,
  pendingWindows;
export function parseWindowsProxy(raw, protocol = "https:") {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const entries = raw.split(";").map((part) => part.trim());
  const mapping = Object.fromEntries(
    entries
      .filter((part) => part.includes("="))
      .map((part) => {
        const i = part.indexOf("=");
        return [part.slice(0, i).toLowerCase(), part.slice(i + 1)];
      }),
  );
  const value = Object.keys(mapping).length
    ? mapping[protocol === "https:" ? "https" : "http"] || mapping.http
    : entries[0];
  if (!value) return null;
  try {
    const url = new URL(
      /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function isLoopbackProxy(input) {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(input).hostname,
    );
  } catch {
    return false;
  }
}
export async function proxyPortOpen(input) {
  const url = new URL(input);
  return new Promise((resolve) => {
    const socket = createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
async function windowsProxy() {
  if (process.platform !== "win32") return null;
  if (refreshAt > Date.now()) return cachedWindows;
  if (pendingWindows) return pendingWindows;
  pendingWindows = (async () => {
    try {
      const { stdout } = await runFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' | Select-Object ProxyEnable,ProxyServer,AutoConfigURL | ConvertTo-Json -Compress",
        ],
        {
          windowsHide: true,
          timeout: 6000,
          encoding: "utf8",
          maxBuffer: 16384,
        },
      );
      cachedWindows = JSON.parse(stdout.trim());
      refreshAt = Date.now() + 5000;
    } catch {
      // PowerShell 冷启动在机器忙时可能超时：沿用上一次读到的系统代理设置，
      // 不要因为一次读取失败就当成「没有代理」直连（直连会被拦下，表现为无法建立网络连接），稍后再试
      refreshAt = Date.now() + 1500;
    }
    pendingWindows = undefined;
    return cachedWindows;
  })();
  return pendingWindows;
}
export async function resolveNetwork(protocol = "https:", options = {}) {
  const environment = options.environment ?? process.env;
  const explicit =
    protocol === "https:"
      ? environment.https_proxy ||
        environment.HTTPS_PROXY ||
        environment.http_proxy ||
        environment.HTTP_PROXY
      : environment.http_proxy || environment.HTTP_PROXY;
  if (explicit)
    return { mode: "environment", label: "使用环境变量代理", proxy: null };
  const config = options.windows ?? (await windowsProxy());
  const proxy = parseWindowsProxy(config?.ProxyServer, protocol);
  if (proxy && config?.ProxyEnable)
    return { mode: "system", label: "使用 Windows 系统代理", proxy };
  // Some VPN clients use TUN with the Windows switch off. The saved loopback
  // listener remains usable by this app; never scan ports or change OS settings.
  if (
    proxy &&
    isLoopbackProxy(proxy) &&
    (await (options.probe ?? proxyPortOpen)(proxy))
  )
    return {
      mode: "local",
      label: "使用已配置的本机代理（系统代理开关关闭）",
      proxy,
    };
  return {
    mode: "direct",
    label: config?.AutoConfigURL
      ? "直接连接（暂不支持 PAC 自动代理）"
      : "直接连接（未检测到可用代理）",
    proxy: null,
  };
}
