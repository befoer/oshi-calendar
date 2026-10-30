/**
 * 手动分发版读取公开更新清单，不消耗 GitHub REST API 额度。
 */
import { load } from "js-yaml";
export const RELEASES_PAGE = "https://github.com/befoer/oshi-calendar/releases";
export const UPDATE_MANIFEST = `${RELEASES_PAGE}/latest/download/latest.yml`;

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

/**
 * 查最新版本。返回 { status: "latest" | "available" | "error", current, latest?, url?, notes?, message? }
 */
export async function checkForUpdate(current, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(UPDATE_MANIFEST, {
      headers: {
        Accept: "text/yaml, text/plain, */*",
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
    const text = await response.text();
    let manifest;
    try {
      if (text.length > 256_000) throw new Error("invalid manifest");
      manifest = load(text, { json: true });
    } catch {
      return {
        status: "error",
        current,
        message: "更新清单无效，请前往发布页查看",
      };
    }
    const latest = manifest?.version;
    if (typeof latest !== "string" || !/^\d+\.\d+\.\d+$/.test(latest))
      return {
        status: "error",
        current,
        message: "更新清单无效，请前往发布页查看",
      };
    if (compareVersions(latest, current) <= 0)
      return { status: "latest", current, latest };
    return {
      status: "available",
      current,
      latest,
      url: `${RELEASES_PAGE}/download/v${latest}/oshi-calendar-${latest}-setup.exe`,
      page: `${RELEASES_PAGE}/tag/v${latest}`,
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

export function createUpdateChecker(
  check,
  {
    current,
    readCache = async () => null,
    writeCache = async () => {},
    cacheAvailable = true,
    now = Date.now,
  },
) {
  let cached;
  let pending;
  const valid = (entry, ttl) =>
    entry?.result?.current === current &&
    ["latest", "available", "error"].includes(entry.result.status) &&
    Number.isFinite(entry.at) &&
    now() >= entry.at &&
    now() - entry.at < ttl;
  return {
    clear() {
      cached = undefined;
    },
    check({ automatic = false } = {}) {
      if (pending) return pending;
      pending = (async () => {
        if (valid(cached, 60_000)) return cached.result;
        if (automatic) {
          const saved = await readCache().catch(() => null);
          if (
            valid(
              saved,
              saved?.result?.status === "error" ? 60_000 : 6 * 60 * 60_000,
            ) &&
            (cacheAvailable || saved.result.status !== "available")
          )
            return saved.result;
        }
        const result = await check();
        cached = { at: now(), result };
        await writeCache(
          cacheAvailable || result.status !== "available" ? cached : null,
        ).catch(() => {});
        return result;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
