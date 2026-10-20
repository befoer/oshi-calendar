import { localCharacterService } from "./external-network";
import { anilistEnglishName } from "./anilist";

/**
 * 自动获取角色 Tag。
 * 首选 Danbooru（tags.json 找角色标签，related_tag.json 取外观标签）；
 * Danbooru 不可用（网络、Cloudflare 校验、无结果）时回退到 AnimaDex 的角色索引，
 * 它的数据同样来自 Danbooru，并直接带有外观标签。
 */
export type TagSource = "Danbooru" | "AnimaDex";
export type TagCandidate = {
  /** Danbooru 标签名，空格用下划线，如 elaina_(majo_no_tabitabi) */
  slug: string;
  /** 作品标签（括号里的部分），可能为空 */
  copyright: string;
  /** Danbooru 上的帖子数，用来排序和提示热门程度 */
  count: number;
  /** 外观标签（发色、瞳色、服装等），Danbooru 来源在选中时才加载 */
  appearance: string[];
  loaded: boolean;
};
export type TagLookup = { source: TagSource; candidates: TagCandidate[] };

const NOISE = new Set([
  "1girl",
  "1boy",
  "2girls",
  "solo",
  "multiple girls",
  "looking at viewer",
  "smile",
  "blush",
  "open mouth",
  "closed mouth",
  "simple background",
  "white background",
  "highres",
  "absurdres",
  "commentary request",
  "translated",
  "breasts",
  "small breasts",
  "medium breasts",
  "large breasts",
  "sitting",
  "standing",
  "upper body",
  "full body",
  "cowboy shot",
  "bangs",
  "official alternate costume",
]);

/** Danbooru 标签名 → 生图提示词写法：下划线变空格，括号加反斜杠转义。 */
export const tagToPrompt = (slug: string) =>
  slug.replace(/_/g, " ").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** 作品标签：elaina_(majo_no_tabitabi) → majo no tabitabi */
export const copyrightOf = (slug: string) =>
  slug.match(/_\(([^()]+)\)$/)?.[1]?.replace(/_/g, " ") ?? "";

/** 去重、去掉噪声标签与角色/作品名本身，保留前 limit 个外观标签。 */
export function cleanAppearance(
  tags: string[],
  exclude: string[] = [],
  limit = 8,
) {
  const skip = new Set(
    [...exclude].map((t) => t.replace(/_/g, " ").toLowerCase()),
  );
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/_/g, " ").trim().toLowerCase();
    if (!tag || NOISE.has(tag) || skip.has(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

/** 角色 Tag：只有角色标签本身，例如 nahida \(genshin impact\)。复制按钮复制的就是它。 */
export const candidateTag = (candidate: TagCandidate) =>
  tagToPrompt(candidate.slug);
/** 人物特征：发色、瞳色、服装等外观标签，单独保存，不随复制按钮复制。 */
export const candidateTraits = (candidate: TagCandidate) =>
  candidate.appearance.join(", ");

/* ---------- 解析各来源的响应（独立出来便于测试） ---------- */
export function parseDanbooruTags(data: unknown): TagCandidate[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (row): row is { name: string; post_count?: number; is_deprecated?: boolean } =>
        !!row &&
        typeof row === "object" &&
        typeof (row as { name?: unknown }).name === "string" &&
        (row as { is_deprecated?: boolean }).is_deprecated !== true,
    )
    .map((row) => ({
      slug: row.name,
      copyright: copyrightOf(row.name),
      count: Number(row.post_count) || 0,
      appearance: [],
      loaded: false,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}
export function parseDanbooruRelated(data: unknown, exclude: string[] = []) {
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { related_tags?: unknown })?.related_tags)
      ? (data as { related_tags: unknown[] }).related_tags
      : [];
  const rows = list
    .map((entry) => {
      if (Array.isArray(entry))
        return { name: String(entry[0] ?? ""), category: Number(entry[1]), frequency: 1 };
      const e = entry as {
        tag?: { name?: string; category?: number };
        name?: string;
        category?: number;
        frequency?: number;
      };
      return {
        name: e.tag?.name ?? e.name ?? "",
        category: e.tag?.category ?? e.category,
        frequency: typeof e.frequency === "number" ? e.frequency : 1,
      };
    })
    // 类别 0 = 一般标签（发色、服装等）；缺省类别时按名称保留
    .filter((r) => r.name && (r.category === 0 || r.category === undefined))
    .filter((r) => r.frequency >= 0.2)
    .sort((a, b) => b.frequency - a.frequency)
    .map((r) => r.name);
  return cleanAppearance(rows, exclude);
}
export function parseAnimaDex(data: unknown): TagCandidate[] {
  const results = (data as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter(
      (r): r is { slug: string; tags?: string[]; count?: number } =>
        !!r && typeof (r as { slug?: unknown }).slug === "string",
    )
    .map((r) => ({
      slug: r.slug,
      copyright: copyrightOf(r.slug),
      count: Number(r.count) || 0,
      appearance: cleanAppearance(
        Array.isArray(r.tags) ? r.tags.filter((t) => typeof t === "string") : [],
        [r.slug, copyrightOf(r.slug)],
      ),
      loaded: true,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

/* ---------- 网络 ---------- */
type Params = Record<string, string>;
const endpoints = {
  Danbooru: "https://danbooru.donmai.us",
  AnimaDex: "https://animadex.net",
} as const;

async function direct(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function viaLocal(source: TagSource, params: Params, signal?: AbortSignal) {
  const response = await fetch("/__huiqi_character/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, ...params }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.error === "string" ? body.error : `HTTP ${response.status}`,
    );
  return body;
}
/**
 * 有本机资料服务时一律走它：同源、复用系统代理，且 AnimaDex 没有跨域头、
 * Danbooru 的直连常被 Cloudflare 校验拦下，直连只会白等超时。
 * 纯静态部署没有本机服务时才尝试浏览器直连。
 */
async function request(
  source: TagSource,
  path: string,
  params: Params,
  signal?: AbortSignal,
) {
  const local = localCharacterService();
  const url = endpoints[source] + path;
  // 系统代理偶尔会瞬断：网络层失败（而不是对方返回 HTTP 错误）时重试一次
  const flaky = (error: unknown) =>
    error instanceof Error && /网络连接|超时|timeout|fetch failed/i.test(error.message);
  const viaLocalRetry = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await viaLocal(source, params, signal);
      } catch (error) {
        if (signal?.aborted || attempt >= 2 || !flaky(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
  };
  // 本机服务的 Node 请求不一定走得通浏览器的网络（比如系统用的是 PAC 脚本代理），
  // Danbooru 带跨域头，所以本机服务失败后再让浏览器自己直连一次。AnimaDex 没有跨域头，不试。
  const attempts: (() => Promise<unknown>)[] = local
    ? [viaLocalRetry, ...(source === "Danbooru" ? [() => direct(url, signal)] : [])]
    : [() => direct(url, signal)];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    local
      ? failures.length > 1
        ? `${failures[0]}；浏览器直连也失败：${failures[1]}`
        : failures[0]
      : `${failures[0]}（纯静态部署无法代理该来源，请通过 start.cmd 启动本地服务）`,
  );
}

export async function danbooruCandidates(term: string, signal?: AbortSignal) {
  const words = term.trim().toLowerCase().split(/[\s_]+/).filter(Boolean);
  if (!words.length) return [];
  const ask = async (pattern: string) =>
    parseDanbooruTags(
      await request(
        "Danbooru",
        `/tags.json?${new URLSearchParams({
          "search[name_or_alias_matches]": pattern,
          "search[category]": "4",
          "search[order]": "count",
          limit: "10",
        })}`,
        { action: "tags", pattern },
        signal,
      ),
    );
  // 先按开头匹配（paimon*，走索引、很快），没有再放宽到「包含」（*kamado*nezuko*）：
  // 前后都带通配符的查询要扫全表，常见名字（klee、paimon）容易被 Danbooru 超时掐断
  const prefix = await ask(`${words.join("*")}*`);
  return prefix.length ? prefix : ask(`*${words.join("*")}*`);
}
export async function loadAppearance(
  candidate: TagCandidate,
  signal?: AbortSignal,
): Promise<TagCandidate> {
  if (candidate.loaded) return candidate;
  const exclude = [candidate.slug, candidate.copyright];
  const ask = (category: boolean) =>
    request(
      "Danbooru",
      `/related_tag.json?${new URLSearchParams({
        "search[query]": candidate.slug,
        "search[order]": "Frequency",
        ...(category ? { "search[category]": "0" } : {}),
      })}`,
      { action: "related", tag: candidate.slug, category: category ? "0" : "" },
      signal,
    );
  let data: unknown;
  try {
    data = await ask(true);
  } catch (error) {
    if (signal?.aborted) throw error;
    data = await ask(false);
  }
  return {
    ...candidate,
    appearance: parseDanbooruRelated(data, exclude),
    loaded: true,
  };
}
export async function animadexCandidates(term: string, signal?: AbortSignal) {
  const query = term.trim();
  if (!query) return [];
  return parseAnimaDex(
    await request(
      "AnimaDex",
      `/api/characters/search?${new URLSearchParams({ q: query, page: "1" })}`,
      { action: "search", query },
      signal,
    ),
  );
}

/**
 * 依次用若干个名字（英文名优先，其次日文名/中文名）查找角色 Tag。
 * 返回候选列表，调用方让用户选择；两个来源都失败时抛出带原因的错误。
 */
export async function lookupCharacterTags(
  terms: string[],
  signal?: AbortSignal,
): Promise<TagLookup> {
  let names = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 4);
  if (!names.length) throw new Error("没有可用于搜索的角色名");
  // Danbooru / AnimaDex 只认英文名：资料里没有英文名时，用日文原名到 AniList 查一个
  if (!names.some((n) => /^[ -~]+$/.test(n) && /[a-z]/i.test(n))) {
    const native = names.find((n) => /[぀-ヿ]/.test(n)) ?? names[0];
    const english = await anilistEnglishName(native, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (english) names = [english, ...names].slice(0, 4);
  }
  const reasons: string[] = [];
  let danbooruError = "";
  for (const term of names) {
    try {
      const candidates = await danbooruCandidates(term, signal);
      if (candidates.length) {
        try {
          candidates[0] = await loadAppearance(candidates[0], signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          // 外观标签取不到时仍然返回角色名标签
          candidates[0] = { ...candidates[0], loaded: false };
        }
        return { source: "Danbooru", candidates };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      danbooruError = error instanceof Error ? error.message : String(error);
      // 网络层失败（重试和直连都试过了）换名字也一样，直接去下一个来源；
      // 对方返回的 HTTP 错误（如查询超时）可能只和这个名字有关，继续试下一个名字
      if (/网络连接|超时|拒绝连接|域名解析|证书|ECONN|fetch/i.test(danbooruError)) break;
    }
  }
  reasons.push(
    danbooruError
      ? `Danbooru：${/403/.test(danbooruError) ? "被 Cloudflare 人机校验拦下（HTTP 403），多半是当前代理节点的 IP 被拦，可换个节点" : danbooruError}`
      : "Danbooru 没有找到匹配的角色标签",
  );
  try {
    for (const term of names) {
      const candidates = await animadexCandidates(term, signal);
      if (candidates.length) return { source: "AnimaDex", candidates };
    }
    reasons.push("AnimaDex 没有找到匹配的角色");
  } catch (error) {
    if (signal?.aborted) throw error;
    reasons.push(`AnimaDex：${error instanceof Error ? error.message : error}`);
  }
  throw new Error(reasons.join("；"));
}
