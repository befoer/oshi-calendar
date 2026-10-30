/**
 * 在线更新：读取 GitHub 上 befoer/oshi-calendar 的最新 Release（推送 v* 版本标签后由 Actions 自动发布），
 * 比当前版本新就提示下载。只替换程序，不动「推日数据」文件夹。
 * 仓库未公开或没联网时接口拿不到，静默跳过（手动检查时给出原因）。
 */
export const RELEASES_API =
  "https://api.github.com/repos/befoer/oshi-calendar/releases/latest";
export const RELEASES_PAGE = "https://github.com/befoer/oshi-calendar/releases";

/** 比较 1.2.10 与 1.2.9 这类版本号；a 比 b 新返回正数。 */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v)
      .replace(/^v/i, "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** 旧分发方式的手动下载入口：优先安装版，旧 Release 兼容 ZIP 与便携 EXE。 */
export function pickDownload(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zip = assets.find((a) => /\.zip$/i.test(a.name));
  const installer = assets.find((a) => /-setup\.exe$/i.test(a.name));
  const exe = assets.find((a) => /\.exe$/i.test(a.name));
  return (
    (installer ?? zip ?? exe)?.browser_download_url ||
    release?.html_url ||
    RELEASES_PAGE
  );
}

/**
 * 查最新版本。返回 { status: "latest" | "available" | "error", current, latest?, url?, notes?, message? }
 */
export async function checkForUpdate(current, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "befoer/oshi-calendar",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404)
      return {
        status: "error",
        current,
        message: "还没有发布过版本，或仓库暂未公开",
      };
    if (!response.ok)
      return {
        status: "error",
        current,
        message: `GitHub 返回 HTTP ${response.status}`,
      };
    const release = await response.json();
    if (release.draft || release.prerelease)
      return { status: "latest", current };
    const latest = String(release.tag_name || "").replace(/^v/i, "");
    if (!latest || compareVersions(latest, current) <= 0)
      return { status: "latest", current, latest: latest || current };
    return {
      status: "available",
      current,
      latest,
      url: pickDownload(release),
      page: release.html_url || RELEASES_PAGE,
      notes: String(release.body || "").slice(0, 600),
    };
  } catch (error) {
    return {
      status: "error",
      current,
      message:
        error?.name === "TimeoutError"
          ? "连接 GitHub 超时，请检查网络或代理"
          : "无法连接 GitHub，请检查网络或代理",
    };
  }
}
