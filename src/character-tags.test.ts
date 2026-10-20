import { afterEach, expect, it, vi } from "vitest";
import {
  candidateTag,
  candidateTraits,
  cleanAppearance,
  copyrightOf,
  lookupCharacterTags,
  parseAnimaDex,
  parseDanbooruRelated,
  parseDanbooruTags,
  tagToPrompt,
} from "./character-tags";

afterEach(() => vi.unstubAllGlobals());

it("Danbooru 标签名转成提示词写法：下划线变空格，括号转义，并取出作品名", () => {
  expect(tagToPrompt("elaina_(majo_no_tabitabi)")).toBe(
    "elaina \\(majo no tabitabi\\)",
  );
  expect(copyrightOf("elaina_(majo_no_tabitabi)")).toBe("majo no tabitabi");
  expect(copyrightOf("hatsune_miku")).toBe("");
});

it("外观标签去重、去掉噪声与角色名本身，并限制数量", () => {
  expect(
    cleanAppearance(
      ["1girl", "solo", "long_hair", "Long Hair", "blue eyes", "elaina", "witch hat"],
      ["elaina"],
      3,
    ),
  ).toEqual(["long hair", "blue eyes", "witch hat"]);
});

it("Danbooru 标签响应按帖子数排序，跳过已弃用和零帖子标签", () => {
  const candidates = parseDanbooruTags([
    { name: "elaina_(majo_no_tabitabi)", post_count: 1200, category: 4 },
    { name: "elaina_(old)", post_count: 9999, is_deprecated: true },
    { name: "elaina_(fanart)", post_count: 0 },
    { name: "elaina_(other)", post_count: 40 },
  ]);
  expect(candidates.map((c) => c.slug)).toEqual([
    "elaina_(majo_no_tabitabi)",
    "elaina_(other)",
  ]);
  expect(candidates[0]).toMatchObject({
    copyright: "majo no tabitabi",
    loaded: false,
  });
  expect(parseDanbooruTags({ error: "x" })).toEqual([]);
});

it("相关标签只取一般类别且频率足够的标签，兼容对象和数组两种响应", () => {
  const object = {
    related_tags: [
      { tag: { name: "majo_no_tabitabi", category: 3 }, frequency: 0.99 },
      { tag: { name: "solo", category: 0 }, frequency: 0.9 },
      { tag: { name: "grey_hair", category: 0 }, frequency: 0.8 },
      { tag: { name: "witch_hat", category: 0 }, frequency: 0.5 },
      { tag: { name: "rare_thing", category: 0 }, frequency: 0.05 },
    ],
  };
  expect(parseDanbooruRelated(object)).toEqual(["grey hair", "witch hat"]);
  expect(
    parseDanbooruRelated([
      ["blue_eyes", 0],
      ["elaina_(majo_no_tabitabi)", 4],
    ]),
  ).toEqual(["blue eyes"]);
});

it("AnimaDex 响应直接带外观标签", () => {
  const candidates = parseAnimaDex({
    results: [
      {
        slug: "elaina_(majo_no_tabitabi)",
        count: 1217,
        tags: ["1girl", "blue eyes", "white hair", "witch hat", "witch", "witch"],
      },
    ],
  });
  expect(candidates[0]).toMatchObject({
    count: 1217,
    loaded: true,
    appearance: ["blue eyes", "white hair", "witch hat", "witch"],
  });
  // Tag 只含角色标签；外观特征另存，不会混进 Tag
  expect(candidateTag(candidates[0])).toBe("elaina \\(majo no tabitabi\\)");
  expect(candidateTraits(candidates[0])).toBe(
    "blue eyes, white hair, witch hat, witch",
  );
});

it("Danbooru 无法访问时回退到 AnimaDex；两个来源都失败时说明原因", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("danbooru")) return new Response("blocked", { status: 403 });
    return new Response(
      JSON.stringify({
        results: [{ slug: "roxy_migurdia", count: 500, tags: ["blue hair", "braid"] }],
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await lookupCharacterTags(["Roxy Migurdia", "Roxy Migurdia"]);
  expect(result.source).toBe("AnimaDex");
  expect(result.candidates[0].slug).toBe("roxy_migurdia");
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes("danbooru"))).toBe(true);

  vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
  await expect(lookupCharacterTags(["Nobody"])).rejects.toThrow(/Danbooru.*AnimaDex/);
  await expect(lookupCharacterTags(["  "])).rejects.toThrow("没有可用于搜索的角色名");
});

it("Danbooru 命中时返回候选并加载外观标签", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.includes("related_tag")
            ? {
                related_tags: [
                  { tag: { name: "silver_hair", category: 0 }, frequency: 0.7 },
                ],
              }
            : [{ name: "kafu_chino", post_count: 3000 }],
        ),
        { status: 200 },
      );
    }),
  );
  const result = await lookupCharacterTags(["Kafuu Chino"]);
  expect(result.source).toBe("Danbooru");
  expect(result.candidates[0]).toMatchObject({
    slug: "kafu_chino",
    appearance: ["silver hair"],
    loaded: true,
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

it("Danbooru 先按开头匹配（paimon*），没有再放宽到包含（*paimon*）", async () => {
  const patterns: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("related_tag"))
        return json({ related_tags: [] });
      const pattern = url.searchParams.get("search[name_or_alias_matches]")!;
      patterns.push(pattern);
      return json(pattern.startsWith("*") ? [{ name: "xx_paimon", post_count: 9 }] : []);
    }),
  );
  const result = await lookupCharacterTags(["Paimon"]);
  expect(patterns).toEqual(["paimon*", "*paimon*"]);
  expect(result.candidates[0].slug).toBe("xx_paimon");
  patterns.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("related_tag"))
        return json({ related_tags: [] });
      patterns.push(url.searchParams.get("search[name_or_alias_matches]")!);
      return json([{ name: "paimon_(genshin_impact)", post_count: 6004 }]);
    }),
  );
  const hit = await lookupCharacterTags(["Paimon", "派蒙"]);
  expect(patterns).toEqual(["paimon*"]);
  expect(hit.candidates[0].slug).toBe("paimon_(genshin_impact)");
});

it("本机资料服务连不上 Danbooru 时，浏览器自己直连一次", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith("/__huiqi_character/api"))
        return json({ error: "角色资料获取失败：无法建立网络连接（ECONNRESET）" }, 502);
      if (url.includes("related_tag")) return json({ related_tags: [] });
      return json([{ name: "paimon_(genshin_impact)", post_count: 6004 }]);
    }),
  );
  const result = await lookupCharacterTags(["Paimon"]);
  expect(result.source).toBe("Danbooru");
  expect(result.candidates[0].slug).toBe("paimon_(genshin_impact)");
  expect(urls.some((u) => u.startsWith("https://danbooru.donmai.us/tags.json"))).toBe(true);
}, 20000);

it("本机服务和浏览器直连都失败时，错误里带上两边的原因；网络层失败不再逐个名字重试", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  let localCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/__huiqi_character/api")) {
        localCalls++;
        return json({ error: "角色资料获取失败：无法建立网络连接（ECONNRESET）" }, 502);
      }
      throw new TypeError("Failed to fetch");
    }),
  );
  await expect(lookupCharacterTags(["Paimon", "派蒙"])).rejects.toThrow(
    /Danbooru：.*ECONNRESET.*浏览器直连也失败：Failed to fetch/,
  );
  // 只试了第一个名字：Danbooru 一轮 + AnimaDex 一轮，每轮最多 3 次本机请求
  expect(localCalls).toBeLessThanOrEqual(6);
}, 30000);

it("资料里没有英文名时，用日文原名到 AniList 查英文名再搜；Danbooru 被 403 拦下仍能走 AnimaDex", async () => {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co"))
        return json({
          data: {
            Page: {
              characters: [
                { id: 1, name: { full: "Other", native: "別人" } },
                { id: 152458, name: { full: "Columbia", native: "コロンビア" } },
              ],
            },
          },
        });
      if (url.includes("danbooru")) return new Response("blocked", { status: 403 });
      asked.push(new URL(url).searchParams.get("q") ?? "");
      return json({
        results: [{ slug: "columbia_(azur_lane)", name: "Columbia", tags: ["red eyes"] }],
      });
    }),
  );
  const result = await lookupCharacterTags(["哥伦比亚", "コロンビア"]);
  expect(result.source).toBe("AnimaDex");
  expect(asked[0]).toBe("Columbia");
  expect(result.candidates[0].slug).toBe("columbia_(azur_lane)");
});
