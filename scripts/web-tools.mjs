import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { lookup as lookupCallback } from "node:dns";
import { isIP } from "node:net";
import { once } from "node:events";
import { fetch, EnvHttpProxyAgent, ProxyAgent } from "undici";
import { resolveNetwork } from "./network.mjs";

export const webVersion = "web-tools-1";
// Bangumi 要求非浏览器请求带「开发者 ID/应用名」；项目私有，不附主页地址
const characterUserAgent = "befoer/oshi-calendar/1.0";
const environmentDispatcher = new EnvHttpProxyAgent({
  connect: {
    lookup(host, options, callback) {
      lookupCallback(host, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error);
        if (
          !addresses.length ||
          addresses.some(({ address }) => !publicAddress(address))
        )
          return callback(new Error("网页工具不能连接内网地址"));
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
const proxyDispatchers = new Map();
function dispatcherFor(network) {
  if (!network.proxy) return environmentDispatcher;
  if (!proxyDispatchers.has(network.proxy))
    proxyDispatchers.set(network.proxy, new ProxyAgent(network.proxy));
  return proxyDispatchers.get(network.proxy);
}
export function networkError(error) {
  if (error.name === "TimeoutError") return "连接超时";
  const code = error.cause?.code || error.code;
  if (["ECONNREFUSED", "UND_ERR_CONNECT"].includes(code))
    return "代理或站点拒绝连接";
  if (["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"].includes(code))
    return "连接超时";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "域名解析失败";
  if (
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_HAS_EXPIRED",
    ].includes(code)
  )
    return "HTTPS 证书验证失败";
  // 没有归类的网络层失败：把底层错误码带上（如 ECONNRESET），方便判断是代理、证书还是站点的问题
  return error.message === "fetch failed"
    ? `无法建立网络连接${code || error.cause?.message ? `（${code || error.cause.message}）` : ""}`
    : error.message;
}
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Globally routable unicast only; IPv4-mapped and local IPv6 are excluded.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address);
}
export async function publicURL(input) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("只能读取无登录信息的公开 HTTP(S) 网页");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  )
    throw new Error("网页工具不能访问本机、内网或非公开地址");
  url.hash = "";
  return url;
}
async function download(input, signal) {
  let url = await publicURL(input);
  for (let attempt = 0; attempt < 5; attempt++) {
    signal.throwIfAborted();
    const network = await resolveNetwork(url.protocol);
    const response = await fetch(url, {
      dispatcher: dispatcherFor(network),
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Huiqi/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml,text/plain",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = await publicURL(
        new URL(response.headers.get("location") || "", url).href,
      );
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `网页来源返回 HTTP ${response.status}${response.status === 429 ? "（站点限流）" : response.status === 503 ? "（站点暂不可用或存在访问验证）" : ""}，请更换来源`,
      );
    }
    const type = response.headers.get("content-type") || "";
    if (!/text\/|html|xml|json/i.test(type)) {
      await response.body?.cancel();
      throw new Error("暂时只能读取网页文本，不能读取图片或 PDF");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2_000_000)
        throw new Error("网页超过 2 MB，请选择较短的资料页面");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const charset =
      type.match(/charset=["']?([\w-]+)/i)?.[1] ||
      bytes.toString("ascii", 0, 2048).match(/charset=["']?([\w-]+)/i)?.[1] ||
      "utf-8";
    let html;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      html = bytes.toString("utf8");
    }
    return {
      html,
      url: url.href,
      network: { mode: network.mode, label: network.label },
    };
  }
  throw new Error("网页重定向过多，请选择直接的资料链接");
}
export function extractPage(html, url) {
  const $ = load(html);
  const title = $("title").first().text().trim() || url;
  $("script,style,noscript,svg,iframe,form,nav,footer,header").remove();
  $("br,p,div,li,tr,h1,h2,h3,h4,section,article").append("\n");
  const text = (
    $("main,article,#mw-content-text,.mw-parser-output").first().text() ||
    $("body").text() ||
    $.root().text()
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  if (
    text.length < 30 ||
    /verify you are human|checking your browser|just a moment|captcha/i.test(
      title,
    )
  )
    throw new Error("该网页未提供可读取正文，可能有验证码；请搜索其他来源");
  // Keep both the opening context and birthday passages from long wiki pages.
  const sections = [
    ...text.matchAll(
      /.{0,350}(?:birthday|birth date|date of birth|生日|誕生日|出生日期).{0,650}/gi,
    ),
  ]
    .slice(0, 12)
    .map((match) => match[0]);
  return {
    url,
    title,
    text:
      text.length <= 18000
        ? text
        : text.slice(0, 10000) +
          "\n[正文节选：生日相关段落]\n" +
          sections.join("\n"),
    truncated: text.length > 18000,
  };
}
export function parseSearch(html, provider) {
  const $ = load(html);
  const results = [];
  if (provider === "Bing") {
    $(".b_algo").each((_, item) => {
      const el = $(item);
      let url = el.find("h2 a").attr("href") || "";
      try {
        const parsed = new URL(url);
        if (
          parsed.hostname.endsWith("bing.com") &&
          parsed.pathname === "/ck/a"
        ) {
          const encoded = parsed.searchParams.get("u");
          if (encoded?.startsWith("a1"))
            url = Buffer.from(encoded.slice(2), "base64url").toString("utf8");
        }
      } catch {
        return;
      }
      results.push({
        title: el.find("h2").text(),
        url,
        snippet: el.find(".b_caption p").text(),
      });
    });
  } else {
    $(".result").each((_, item) => {
      const el = $(item),
        link = el.find(".result__a");
      let url = link.attr("href") || "";
      try {
        const parsed = new URL(url, "https://duckduckgo.com");
        url = parsed.searchParams.get("uddg") || parsed.href;
      } catch {
        return;
      }
      results.push({
        title: link.text(),
        url,
        snippet: el.find(".result__snippet").text(),
      });
    });
  }
  return results
    .filter((r) => /^https?:\/\//.test(r.url) && r.title.trim())
    .slice(0, 8)
    .map((r) => ({
      ...r,
      title: r.title.trim().slice(0, 300),
      snippet: r.snippet.trim().slice(0, 1200),
    }));
}
export async function searchWeb(query, signal) {
  const failures = [];
  for (const [provider, address] of [
    ["Bing", "https://www.bing.com/search?q="],
    ["DuckDuckGo", "https://html.duckduckgo.com/html/?q="],
  ]) {
    try {
      const page = await download(
        address + encodeURIComponent(query),
        AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      );
      const results = parseSearch(page.html, provider);
      const terms =
        query
          .replace(/(?:site|filetype|intitle):\S+/gi, "")
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu)
          ?.filter(
            (word) =>
              word.length > 1 &&
              !/^(birthday|birth|date|of|the|official|wiki|生日|誕生日|出生日期)$/.test(
                word,
              ),
          ) || [];
      const relevant = results.some((r) => {
        const text = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
        return (
          terms.filter((word) => text.includes(word)).length >=
          Math.min(2, terms.length)
        );
      });
      if (results.length && relevant)
        return { provider, query, results, network: page.network };
      if (results.length) {
        failures.push(`${provider} 返回的结果与关键词不匹配`);
        continue;
      }
      failures.push(`${provider} 无可读取结果或要求验证`);
    } catch (error) {
      if (signal.aborted) throw error;
      failures.push(`${provider}：${networkError(error)}`);
    }
  }
  throw new Error(`网页搜索失败（${failures.join("；")}）`);
}
export async function handleWebTools(req, res) {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path.startsWith("/__huiqi_character/"))
    return handleCharacterTools(req, res, path);
  if (path === "/__huiqi_ai/relay") return handleAiRelay(req, res);
  if (
    ![
      "/__huiqi_web/search",
      "/__huiqi_web/read",
      "/__huiqi_web/status",
    ].includes(path)
  )
    return false;
  const reply = (status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  if (path.endsWith("status") && req.method === "GET") {
    const network = await resolveNetwork();
    reply(200, {
      success: true,
      network: { mode: network.mode, label: network.label },
    });
    return true;
  }
  if (req.method !== "POST") {
    reply(405, { error: "请使用 POST" });
    return true;
  }
  const origin = req.headers.origin;
  if (
    (origin && new URL(origin).host !== req.headers.host) ||
    req.headers["sec-fetch-site"] === "cross-site" ||
    !req.headers["content-type"]?.startsWith("application/json")
  ) {
    reply(403, { error: "只接受本应用的网页工具请求" });
    return true;
  }
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    let raw = "";
    for await (const part of req) {
      raw += part;
      if (raw.length > 4096) throw new Error("参数过长");
    }
    const input = JSON.parse(raw);
    const field = path.endsWith("search") ? "query" : "url";
    if (
      Object.keys(input).length !== 1 ||
      typeof input[field] !== "string" ||
      !input[field].trim() ||
      input[field].length > (field === "query" ? 300 : 2000)
    )
      throw new Error("网页工具参数无效");
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30000),
    ]);
    const result =
      field === "query"
        ? await searchWeb(input.query.trim(), signal)
        : await download(input.url, signal).then((p) => ({
            ...extractPage(p.html, p.url),
            network: p.network,
          }));
    if (!res.destroyed) reply(200, { success: true, ...result });
  } catch (error) {
    const network = await resolveNetwork();
    if (!res.destroyed)
      reply(502, {
        success: false,
        network: { mode: network.mode, label: network.label },
        error: `${networkError(error)}。${network.label}。${network.mode === "direct" ? "请启动 VPN／代理后重试，应用会自动重新检测" : "请检查当前代理节点或换一个资料来源后重试"}`,
      });
  }
  return true;
}

/**
 * AI 接口中转：很多中转站没有开启浏览器跨域（预检 OPTIONS 直接 403），浏览器直连会被拦下。
 * 浏览器直连失败后，由本机服务代为转发。刻意收得很窄：
 *  - 只接受同源页面发来的 JSON POST（跨站请求、text/plain 一律拒绝）；
 *  - 只转发 GET …/models 与 POST …/chat/completions，不带查询参数；
 *  - 只转发 Authorization，不转发 Cookie 等其他头；
 *  - 只连公网地址，本机和内网的 AI 服务（如 Ollama）仍由浏览器直连；
 *  - 不跟随重定向，不保存也不记录密钥。
 */
async function handleAiRelay(req, res) {
  const refuse = (status, kind, message) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Huiqi-Relay-Error": kind,
    });
    res.end(JSON.stringify({ error: message }));
  };
  if (req.method !== "POST") {
    refuse(405, "refused", "请使用 POST");
    return true;
  }
  const origin = req.headers.origin;
  if (
    (origin && new URL(origin).host !== req.headers.host) ||
    req.headers["sec-fetch-site"] === "cross-site" ||
    !req.headers["content-type"]?.startsWith("application/json")
  ) {
    refuse(403, "refused", "只接受本应用的 AI 接口请求");
    return true;
  }
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const chunks = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 8_000_000) throw new RelayRefusal("请求内容过大");
      chunks.push(part);
    }
    let input, url;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      url = new URL(String(input.url ?? ""));
    } catch {
      throw new RelayRefusal("请求参数无效");
    }
    const method = input.method;
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        (method === "GET" && /\/models$/.test(url.pathname)) ||
        (method === "POST" &&
          (/\/(?:chat\/completions|images\/generations)$/.test(url.pathname) ||
            input.custom === true))
      ) ||
      (method === "GET" ? input.body !== undefined : typeof input.body !== "string" || !input.body) ||
      (typeof input.authorization !== "string" && typeof input.apiKey !== "string") ||
      (input.authorization !== undefined &&
        !/^Bearer [\x21-\x7e]{1,2000}$/.test(input.authorization)) ||
      (input.apiKey !== undefined && !/^[\x21-\x7e]{1,2000}$/.test(input.apiKey))
    )
      throw new RelayRefusal(
        "只能转发 /models、/chat/completions、/images/generations 和自定义生图请求",
      );
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const network = await resolveNetwork(url.protocol);
    const literal = isIP(host) !== 0;
    if (
      literal
        ? !publicAddress(host)
        : host === "localhost" || host.endsWith(".localhost") || !host.includes(".")
    )
      throw new RelayRefusal("只转发公网地址的 AI 接口");
    // 经代理转发时域名由代理解析，本机 DNS（Clash 等的 fake-ip 会解析到 198.18.x.x）没有参考价值；
    // 直连时才在本机解析并确认是公网地址（198.18.0.0/15 是 fake-ip 常用段，直连 + TUN 时也放行）
    if (!literal && network.mode === "direct") {
      const addresses = await lookup(host, { all: true });
      if (
        !addresses.length ||
        addresses.some(
          ({ address }) =>
            !publicAddress(address) && !/^198\.1[89]\./.test(address),
        )
      )
        throw new RelayRefusal("只转发公网地址的 AI 接口");
    }
    const response = await fetch(url, {
      method,
      dispatcher: dispatcherFor(network),
      redirect: "error",
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(310_000),
      ]),
      headers: {
        ...(input.authorization ? { Authorization: input.authorization } : {}),
        ...(input.apiKey ? { "x-api-key": input.apiKey } : {}),
        Accept: input.stream ? "text/event-stream" : "application/json",
        "User-Agent": "Huiqi/1.0 (AI relay)",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: input.body } : {}),
    });
    res.writeHead(response.status, {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 30_000_000) throw new Error("AI 响应过大");
      if (!res.write(chunk))
        await Promise.race([once(res, "drain"), once(res, "close")]);
    }
    res.end();
  } catch (error) {
    if (res.destroyed) return true;
    if (error instanceof RelayRefusal) refuse(400, "refused", error.message);
    else
      refuse(
        502,
        "network",
        `本机服务也无法连接该接口：${networkError(error)}`,
      );
  }
  return true;
}
class RelayRefusal extends Error {}

// Fixed public providers only. This route never forwards user credentials or
// accepts arbitrary API URLs; it shares the web tools' detected local proxy.
async function handleCharacterTools(req, res, path) {
  const reply = (status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const origin = req.headers.origin;
  if (
    (origin && new URL(origin).host !== req.headers.host) ||
    req.headers["sec-fetch-site"] === "cross-site"
  ) {
    reply(403, { error: "只接受本应用的角色资料请求" });
    return true;
  }
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    let url,
      init = {},
      image = false;
    if (path === "/__huiqi_character/image" && req.method === "GET") {
      url = new URL(req.url, "http://localhost").searchParams.get("url");
      const target = new URL(url);
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        target.port ||
        !["lain.bgm.tv", "s4.anilist.co"].includes(target.hostname) ||
        !/\.(?:jpg|jpeg|png|gif|webp)$/i.test(target.pathname)
      )
        throw new Error("不支持该头像来源");
      image = true;
    } else if (path === "/__huiqi_character/api" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new Error("角色资料参数格式无效");
      let raw = "";
      for await (const part of req) {
        raw += part;
        if (raw.length > 16000) throw new Error("角色查询参数过长");
      }
      const input = JSON.parse(raw);
      if (input.source === "Bangumi") {
        if (
          /^\/characters\/[1-9]\d*(?:\/subjects)?$/.test(input.path) &&
          !input.body
        ) {
          url = "https://api.bgm.tv/v0" + input.path;
        } else if (
          input.path === "/search/characters?limit=10" &&
          typeof input.body?.keyword === "string" &&
          input.body.keyword.trim() &&
          input.body.keyword.length <= 300
        ) {
          url = "https://api.bgm.tv/v0/search/characters?limit=10";
          init = {
            method: "POST",
            body: JSON.stringify({
              keyword: input.body.keyword,
              filter: { nsfw: false },
            }),
          };
        } else throw new Error("不支持该 Bangumi 查询");
      } else if (input.source === "AniList") {
        // Only the read-only character queries used by this app are allowed.
        if (
          typeof input.body?.query !== "string" ||
          input.body.query.length > 6000 ||
          !/^query\s*\(/.test(input.body.query) ||
          /\bmutation\b|\bsubscription\b/i.test(input.body.query) ||
          !/\b(?:Character|characters)\s*\(/.test(input.body.query)
        )
          throw new Error("不支持该 AniList 查询");
        url = "https://graphql.anilist.co";
        const fields =
          "id name { full native alternative } image { large medium } dateOfBirth { year month day } media(perPage: 10) { nodes { title { romaji english native } } }";
        const variables = input.body.variables;
        let query;
        if (
          variables &&
          Object.keys(variables).length === 1 &&
          Number.isInteger(variables.id) &&
          variables.id > 0
        )
          query = `query($id: Int!) { Character(id: $id) { ${fields} } }`;
        else if (
          variables &&
          Object.keys(variables).length === 1 &&
          typeof variables.search === "string" &&
          variables.search.trim() &&
          variables.search.length <= 300
        )
          query = `query($search: String!) { Page(perPage: 10) { characters(search: $search) { ${fields} } } }`;
        else throw new Error("AniList 角色查询变量无效");
        init = { method: "POST", body: JSON.stringify({ query, variables }) };
      } else if (input.source === "Danbooru") {
        // Read-only tag lookups used for filling in a character's tag.
        const text = (value, max = 160) => {
          if (
            typeof value !== "string" ||
            !value.trim() ||
            value.length > max ||
            /[\u0000-\u001f]/.test(value)
          )
            throw new Error("Danbooru 查询参数无效");
          return value.trim();
        };
        if (input.action === "tags")
          url =
            "https://danbooru.donmai.us/tags.json?" +
            new URLSearchParams({
              "search[name_or_alias_matches]": text(input.pattern),
              "search[category]": "4",
              "search[order]": "count",
              limit: "10",
            });
        else if (input.action === "related")
          url =
            "https://danbooru.donmai.us/related_tag.json?" +
            new URLSearchParams({
              "search[query]": text(input.tag),
              "search[order]": "Frequency",
              ...(input.category === "0" ? { "search[category]": "0" } : {}),
            });
        else throw new Error("不支持该 Danbooru 查询");
      } else if (input.source === "AnimaDex") {
        if (
          input.action !== "search" ||
          typeof input.query !== "string" ||
          !input.query.trim() ||
          input.query.length > 100 ||
          /[\u0000-\u001f]/.test(input.query)
        )
          throw new Error("不支持该 AnimaDex 查询");
        url =
          "https://animadex.net/api/characters/search?" +
          new URLSearchParams({ q: input.query.trim(), page: "1" });
      } else throw new Error("未知角色资料来源");
    } else {
      reply(405, { error: "不支持该角色资料请求" });
      return true;
    }
    const network = await resolveNetwork();
    const send = () =>
      fetch(url, {
        ...init,
        dispatcher: dispatcherFor(network),
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
        headers: {
          "User-Agent": characterUserAgent,
          Accept: image ? "image/*" : "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    // 代理或站点偶尔会掐断空闲的长连接，第一次请求就会得到不带原因的 fetch failed；
    // 这种瞬断换一条新连接重试即可（域名解析、证书、拒绝连接这类确定性错误不重试）。
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await send();
        break;
      } catch (error) {
        const code = error.cause?.code || error.code;
        const transient =
          error.message === "fetch failed" &&
          ![
            "ENOTFOUND",
            "EAI_AGAIN",
            "ECONNREFUSED",
            "UND_ERR_CONNECT",
            "DEPTH_ZERO_SELF_SIGNED_CERT",
            "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            "CERT_HAS_EXPIRED",
          ].includes(code);
        if (attempt >= 2 || !transient || controller.signal.aborted) throw error;
        if (network.proxy) {
          const stale = proxyDispatchers.get(network.proxy);
          proxyDispatchers.delete(network.proxy);
          void stale?.close().catch(() => {});
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    if (!response.ok) {
      // 对方有回应但拒绝了（如 AniList 临时关闭 API），把对方给的原因带回去，不当成网络问题
      let detail = "";
      try {
        const text = (await response.text()).slice(0, 4000);
        const data = JSON.parse(text);
        detail = String(
          data?.errors?.[0]?.message || data?.message || data?.error || "",
        ).slice(0, 200);
      } catch {
        /* 非 JSON（如 Cloudflare 校验页） */
      }
      reply(502, {
        error: `资料来源返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
        upstreamStatus: response.status,
      });
      return true;
    }
    const mime = response.headers.get("content-type") || "";
    if (image && !/^image\/(?:png|jpeg|webp|gif)(?:;|$)/i.test(mime))
      throw new Error("头像来源未返回支持的图片");
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 3 * 1024 * 1024) throw new Error("角色资料超过大小限制");
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (!image) JSON.parse(body.toString("utf8"));
    res.writeHead(200, {
      "Content-Type": image ? mime : "application/json; charset=utf-8",
      "Cache-Control": image ? "public, max-age=86400" : "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch (error) {
    if (!res.destroyed)
      reply(502, {
        error: `角色资料获取失败：${networkError(error)}；请检查代理节点或更换资料来源`,
      });
  }
  return true;
}
