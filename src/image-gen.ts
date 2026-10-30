import { aiFetch, upstreamMessage } from "./ai";
import type { PromptSyntax } from "./chat-prompts";

/**
 * 生图接口适配。各家生图接口并不统一，所以：
 *  - images：OpenAI 风格 POST {地址}/images/generations（最常见）；
 *  - chat：用对话接口出图（模型在回复里给出图片）；
 *  - custom：自己填完整地址和请求体模板（{{prompt}}、{{model}}、{{size}} 会被替换），认证头可选。
 * 返回内容不要求固定格式：url、b64_json、data URI、Markdown 图片、content 数组里的 image_url 都能识别。
 */
export type ImageKind = "images" | "chat" | "custom";
/** 图片比例：随机＝每次从 3:4、4:3、1:1 里挑一个；自定义＝直接用下面的尺寸文字；不传＝不带尺寸参数。 */
export type SizeMode = "random" | "1:1" | "3:4" | "4:3" | "custom" | "none";
export type ImageConfig = {
  kind: ImageKind;
  endpoint: string;
  model: string;
  sizeMode: SizeMode;
  /** sizeMode 为 custom 时使用，例如 1024x1024 */
  size: string;
  /** 提示词语法，以及固定加在前后的文字（如质量标签） */
  syntax: PromptSyntax;
  prefix: string;
  suffix: string;
  key: string;
  remember: boolean;
  customUrl: string;
  customBody: string;
  authStyle: "bearer" | "x-api-key";
};
const CONFIG_KEY = "huiqi-image-config";
const SESSION_KEY = "huiqi-image-key";

export const defaultCustomBody =
  '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}"\n}';

export function loadImageConfig(): ImageConfig {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  } catch {
    /* 配置损坏时当作没配置 */
  }
  const text = (v: unknown, fallback = "") =>
    typeof v === "string" ? v : fallback;
  const remember = !!raw.remember;
  let sessionKey = "";
  try {
    sessionKey = sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    /* 隐私模式 */
  }
  return {
    kind: raw.kind === "chat" || raw.kind === "custom" ? raw.kind : "images",
    endpoint: text(raw.endpoint),
    model: text(raw.model).trim(),
    sizeMode: ["random", "1:1", "3:4", "4:3", "custom", "none"].includes(
      raw.sizeMode as string,
    )
      ? (raw.sizeMode as SizeMode)
      : // 旧配置：填过尺寸就按自定义，没填过就是新的默认——随机比例
        text(raw.size).trim()
        ? "custom"
        : "random",
    size: text(raw.size).trim(),
    syntax:
      raw.syntax === "natural" || raw.syntax === "chinese"
        ? raw.syntax
        : "tags",
    prefix: text(raw.prefix),
    suffix: text(raw.suffix),
    key: remember ? text(raw.key) : sessionKey,
    remember: true,
    customUrl: text(raw.customUrl),
    customBody: text(raw.customBody, defaultCustomBody),
    authStyle: raw.authStyle === "x-api-key" ? "x-api-key" : "bearer",
  };
}
export function saveImageConfig(config: ImageConfig) {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({ ...config, remember: true }),
  );
  try {
    sessionStorage.setItem(SESSION_KEY, config.key);
  } catch {
    /* 只是会话缓存 */
  }
  window.dispatchEvent(new Event("huiqi-image-config-changed"));
}
export const imageConfigured = (c: ImageConfig) =>
  !!c.key.trim() &&
  (c.kind === "custom"
    ? !!c.customUrl.trim() && !!c.customBody.trim()
    : !!c.endpoint.trim() && !!c.model.trim());

const ratioSizes: Record<string, string> = {
  "1:1": "1024x1024",
  // gpt-image 只支持这三种尺寸，所以 3:4／4:3 取最接近的竖图／横图
  "3:4": "1024x1536",
  "4:3": "1536x1024",
};
/** 这一次出图用的比例和尺寸；随机模式每次从 3:4、4:3、1:1 里挑。 */
export function resolveSize(
  config: Pick<ImageConfig, "sizeMode" | "size">,
  random = Math.random,
): { ratio: string; size: string } {
  if (config.sizeMode === "none") return { ratio: "", size: "" };
  if (config.sizeMode === "custom")
    return { ratio: "", size: config.size.trim() };
  const ratio =
    config.sizeMode === "random"
      ? (["3:4", "4:3", "1:1"] as const)[Math.floor(random() * 3)]
      : config.sizeMode;
  return { ratio, size: ratioSizes[ratio] };
}
/** 提示词前后固定加的文字：标签式用逗号接，自然语言用空格接。 */
export function withAffixes(
  config: Pick<ImageConfig, "prefix" | "suffix" | "syntax">,
  prompt: string,
) {
  const glue = config.syntax === "tags" ? ", " : " ";
  return [config.prefix.trim(), prompt.trim(), config.suffix.trim()]
    .filter(Boolean)
    .join(glue);
}

/** 把文本放进 JSON 字符串字面量里（转义引号、换行等）。 */
const jsonText = (s: string) => JSON.stringify(s).slice(1, -1);

export function buildImageRequest(
  config: ImageConfig,
  prompt: string,
  dims: { ratio: string; size: string } = resolveSize(config),
) {
  const base = config.endpoint.trim().replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(config.authStyle === "x-api-key" && config.kind === "custom"
      ? { "x-api-key": config.key }
      : { Authorization: `Bearer ${config.key}` }),
  };
  if (config.kind === "custom") {
    const body = config.customBody
      .replaceAll("{{prompt}}", jsonText(prompt))
      .replaceAll("{{model}}", jsonText(config.model))
      .replaceAll("{{size}}", jsonText(dims.size))
      .replaceAll("{{ratio}}", jsonText(dims.ratio));
    try {
      JSON.parse(body);
    } catch {
      throw new Error(
        "请求体模板不是有效的 JSON，请检查设置里的「请求体模板」",
      );
    }
    return { url: config.customUrl.trim(), headers, body };
  }
  if (config.kind === "chat")
    return {
      url: `${base}/chat/completions`,
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
      }),
    };
  return {
    url: `${base}/images/generations`,
    headers,
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      ...(dims.size ? { size: dims.size } : {}),
    }),
  };
}

const mimeOfBase64 = (b64: string) =>
  b64.startsWith("/9j/")
    ? "image/jpeg"
    : b64.startsWith("UklG")
      ? "image/webp"
      : b64.startsWith("R0lG")
        ? "image/gif"
        : "image/png";
const fromString = (s: string): string | null => {
  const data = s.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
  if (data) return data[0];
  const markdown = s.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  if (markdown) return markdown[1];
  const url = s.match(
    /https?:\/\/[^\s"'<>()]+\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s"'<>()]*)?/i,
  );
  if (url) return url[0];
  const compact = s.replace(/\s+/g, "");
  if (compact.length > 400 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact))
    return `data:${mimeOfBase64(compact)};base64,${compact}`;
  return null;
};
const b64Keys = new Set(["b64_json", "b64", "base64", "image_base64"]);
const urlKeys = new Set([
  "url",
  "image_url",
  "image",
  "src",
  "output",
  "result",
]);

/** 在任意返回内容里找第一张图：返回可以直接放进 <img src> 的地址或 data URI。 */
export function extractImage(value: unknown, depth = 0): string | null {
  if (depth > 7 || value == null) return null;
  if (typeof value === "string") return fromString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, v] of entries)
    if (b64Keys.has(key) && typeof v === "string" && v.length > 100) {
      const clean = v.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
      return `data:${mimeOfBase64(clean)};base64,${clean}`;
    }
  for (const [key, v] of entries) {
    if (!urlKeys.has(key)) continue;
    const direct = typeof v === "string" ? v : (v as { url?: unknown })?.url;
    if (
      typeof direct === "string" &&
      /^(https?:\/\/|data:image\/)/i.test(direct)
    )
      return direct;
  }
  for (const [, v] of entries) {
    const found = extractImage(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** 发请求出一张图（走与对话相同的「直连失败 → 本机转发」通道），返回图片地址。 */
export async function generateImage(
  config: ImageConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!imageConfigured(config))
    throw new Error("还没有配置生图接口，请到「设置 → 生图接口」填写");
  const request = buildImageRequest(config, withAffixes(config, prompt));
  let response: Response;
  try {
    response = await aiFetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      custom: config.kind === "custom",
      signal: AbortSignal.any([
        AbortSignal.timeout(240000),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch (error) {
    if (signal?.aborted) throw new Error("已取消生图");
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error("生图等待超时（4 分钟），可以稍后重试");
    throw new Error(
      error instanceof Error && error.message
        ? `无法连接生图接口：${error.message}`
        : "无法连接生图接口",
    );
  }
  if (!response.ok) {
    const detail = await upstreamMessage(response, [config.key]);
    throw new Error(
      response.status === 401 || response.status === 403
        ? "生图密钥无效或没有权限"
        : response.status === 402
          ? "生图账户余额不足（402）"
          : `生图失败 (${response.status})${detail ? `：${detail}` : ""}`,
    );
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* 非 JSON：按文本找图 */
  }
  const image = extractImage(body);
  if (!image) {
    const head = text
      .replace(/\s+/g, " ")
      .replaceAll(config.key, "***")
      .slice(0, 120);
    throw new Error(
      `接口返回里没有找到图片（可识别 url、b64_json、data URI、Markdown 图片）。返回开头：${head}`,
    );
  }
  return image;
}
