export type NetworkIssue = {
  source: "Bangumi" | "AniList";
  kind: "timeout" | "unreachable" | "http";
  message: string;
};
export class ExternalRequestError extends Error {
  constructor(public issue: NetworkIssue) {
    super(issue.message);
  }
}
export const localCharacterService = () =>
  typeof location !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
export function avatarFallbackURL(url: string) {
  if (!localCharacterService()) return null;
  try {
    const target = new URL(url);
    return target.protocol === "https:" &&
      ["lain.bgm.tv", "s4.anilist.co"].includes(target.hostname)
      ? `/__huiqi_character/image?url=${encodeURIComponent(url)}`
      : null;
  } catch {
    return null;
  }
}
export async function externalJSON(
  source: NetworkIssue["source"],
  url: string,
  init: RequestInit = {},
  /** quiet：补充性的查询，失败时不弹出网络问题提示 */
  options: { quiet?: boolean } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let issue: NetworkIssue | null = null;
  try {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
    if (!response.ok) {
      issue = {
        source,
        kind: "http",
        message: `${source} 请求失败 (${response.status})${response.status === 429 ? "，请稍后重试" : ""}`,
      };
      throw new ExternalRequestError(issue);
    }
    return await response.json();
  } catch (error) {
    if (localCharacterService() && !(error instanceof ExternalRequestError)) {
      clearTimeout(timer);
      try {
        const endpoint = new URL(url);
        const response = await fetch("/__huiqi_character/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            path: endpoint.pathname.replace(/^\/v0/, "") + endpoint.search,
            ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
          }),
          signal: AbortSignal.timeout(18000),
        });
        if (response.ok) return await response.json();
        const result = await response.json().catch(() => null);
        if (typeof result?.error === "string") {
          issue = {
            source,
            kind: "unreachable",
            message: `${source} 浏览器直连与本地代理获取均失败。${result.error}`,
          };
          throw new ExternalRequestError(issue);
        }
      } catch (fallbackError) {
        if (fallbackError instanceof ExternalRequestError) throw fallbackError;
        /* Keep the original failure and notify only after both paths fail. */
      }
    }
    if (error instanceof ExternalRequestError) throw error;
    if (
      controller.signal.aborted ||
      (error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name))
    )
      issue = { source, kind: "timeout", message: `${source} 请求超时` };
    else if (error instanceof TypeError)
      issue = {
        source,
        kind: "unreachable",
        message: `浏览器无法连接 ${source}，可能是网络、代理或跨域限制`,
      };
    if (issue) throw new ExternalRequestError(issue);
    throw error;
  } finally {
    clearTimeout(timer);
    if (issue && !options.quiet && typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent<NetworkIssue>("character-network-issue", {
          detail: issue,
        }),
      );
  }
}
