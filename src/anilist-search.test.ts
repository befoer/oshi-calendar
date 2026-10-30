import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { newCharacter, defaults } from "./domain";
import { db } from "./store";
import {
  searchAniList,
  findAniListFallback,
  bangumiEnglishName,
} from "./anilist";
import { runAssistant, type AIConfig } from "./ai";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put(defaults);
});
afterEach(() => vi.unstubAllGlobals());
const bgm = {
  id: 1234,
  name: "テストキャラ",
  infobox: [
    { key: "简体中文名", value: "中文角色" },
    {
      key: "别名",
      value: [
        { k: "英文名", v: "English Character" },
        { k: "昵称", v: "nickname" },
      ],
    },
  ],
};
const ani = {
  id: 9999,
  name: { full: "English Character", native: "テストキャラ", alternative: [] },
  dateOfBirth: { year: null, month: 4, day: 2 },
  media: { nodes: [] },
};
const config: AIConfig = {
  endpoint: "https://ai.example/v1",
  model: "test",
  key: "private-key",
  mode: "tools",
  remember: false,
};
it("中文搜索先取得Bangumi英文别名，AniList不接收中文关键词", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: any) => {
      calls.push(String(url));
      if (String(url).includes("/v1/search?")) {
        expect(new URL(String(url)).searchParams.get("query")).toBe("中文角色");
        return new Response(
          JSON.stringify({ data: [{ id: bgm.id, name: bgm.name }] }),
        );
      }
      if (String(url).endsWith("subjects")) return new Response("[]");
      if (String(url).startsWith("https://bangumi-api.acg-dna.top/"))
        return new Response(JSON.stringify(bgm));
      expect(JSON.parse(init.body).variables.search).toBe("English Character");
      return new Response(
        JSON.stringify({ data: { Page: { characters: [ani] } } }),
      );
    }),
  );
  const results = await searchAniList("中文角色");
  expect(results[0].id).toBe(ani.id);
  expect(calls.at(-1)).toBe("https://graphql.anilist.co");
  expect(
    calls.filter((url) => url.startsWith("https://bangumi-api.acg-dna.top/")),
  ).toHaveLength(3);
  expect(calls.some((url) => url.includes("api.bgm.tv"))).toBe(false);
});
it("生日备用查询复用Bangumi返回值，英文名优先于旧别名，并核对身份", async () => {
  const c = newCharacter("中文角色");
  c.bangumiId = bgm.id;
  c.aliases = ["Old English Name"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: any) => {
      expect(url).toBe("https://graphql.anilist.co");
      expect(JSON.parse(init.body).variables.search).toBe("English Character");
      return new Response(
        JSON.stringify({ data: { Page: { characters: [ani] } } }),
      );
    }),
  );
  expect((await findAniListFallback(c, bgm))?.id).toBe(ani.id);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("Bangumi无英文名时不向AniList发送中文；多个重名不擅自选择英文名", async () => {
  let anilistCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("graphql")) anilistCalls++;
      if (String(url).includes("search"))
        return new Response(
          JSON.stringify({
            data: [
              { id: 1, name: "中文角色" },
              { id: 2, name: "中文角色" },
            ],
          }),
        );
      if (String(url).endsWith("subjects")) return new Response("[]");
      return new Response(
        JSON.stringify({
          id: Number(String(url).split("/").at(-1)),
          name: "中文角色",
          infobox: [{ key: "英文名", value: "English Name" }],
        }),
      );
    }),
  );
  await expect(searchAniList("中文角色")).rejects.toThrow("多个");
  const c = newCharacter("无英文角色");
  c.bangumiId = 55;
  await expect(
    searchAniList(c.name, c, { id: 55, name: c.name }),
  ).rejects.toThrow("未取得角色英文名");
  // 只会用日文原名做精确核对，不会把中文名当关键词去搜
  expect(anilistCalls).toBeLessThanOrEqual(1);
});
it("直接输入英文名时不经过 Bangumi，不会被重名拦住", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: any) => {
      calls.push(String(url));
      expect(String(url)).toBe("https://graphql.anilist.co");
      expect(JSON.parse(init.body).variables.search).toBe("Columbia");
      return new Response(
        JSON.stringify({ data: { Page: { characters: [ani] } } }),
      );
    }),
  );
  expect((await searchAniList("Columbia"))[0].id).toBe(ani.id);
  expect(calls).toHaveLength(1);
});
it("英文名提取优先标注明确的英文别名，保留单词次序并过滤人物Tag", () => {
  expect(bangumiEnglishName({ ...bgm, name: "Different Romanized Name" })).toBe(
    "English Character",
  );
  expect(
    bangumiEnglishName({
      id: 1,
      name: "中文",
      infobox: [{ key: "别名", value: [{ k: "罗马字", v: "Kafu Chino" }] }],
    }),
  ).toBe("Kafu Chino");
  expect(
    bangumiEnglishName({
      id: 1,
      name: "中文",
      infobox: [{ key: "别名", value: [{ v: "character, (weight:1.2)" }] }],
    }),
  ).toBeUndefined();
});
it("AI中文AniList搜索同样先获取关联Bangumi角色英文名", async () => {
  const c = newCharacter("中文角色");
  c.bangumiId = bgm.id;
  await db.characters.put(c);
  let modelCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: any) => {
      if (String(url).includes("api.bgm.tv"))
        return new Response(JSON.stringify(bgm));
      if (String(url).includes("graphql")) {
        expect(JSON.parse(init.body).variables.search).toBe(
          "English Character",
        );
        return new Response(
          JSON.stringify({ data: { Page: { characters: [ani] } } }),
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message:
                ++modelCalls === 1
                  ? {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "search",
                          type: "function",
                          function: {
                            name: "search_anilist",
                            arguments: JSON.stringify({ query: c.name }),
                          },
                        },
                      ],
                    }
                  : { role: "assistant", content: "查询完成" },
            },
          ],
        }),
      );
    }),
  );
  const result = await runAssistant(
    config,
    [{ role: "user", content: "从AniList查中文角色" }],
    new AbortController().signal,
    () => {},
  );
  expect(result.text).toBe("查询完成");
  expect(result.logs).toHaveLength(0);
});

it("AI直接关联明确Bangumi角色及生日，返回成功工具结果与可撤销日志", async () => {
  const c = newCharacter("中文角色", "Original TAG, (weight:1.2)");
  await db.characters.put(c);
  let modelCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: any) => {
      if (String(url).endsWith("subjects")) return new Response("[]");
      if (String(url).includes("api.bgm.tv"))
        return new Response(
          JSON.stringify({
            ...bgm,
            birth_mon: 4,
            birth_day: 2,
            images: { medium: "https://lain.bgm.tv/a.jpg" },
          }),
        );
      if (++modelCalls === 1)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "import",
                      type: "function",
                      function: {
                        name: "propose_bangumi_import",
                        arguments: JSON.stringify({
                          characterId: c.id,
                          bangumiId: bgm.id,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      const result = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
      expect(result.success).toBe(true);
      expect(result.changes[0].after.bangumiId).toBe(bgm.id);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "关联已保存" } }],
        }),
      );
    }),
  );
  const result = await runAssistant(
    config,
    [{ role: "user", content: "关联这个角色" }],
    new AbortController().signal,
    () => {},
  );
  expect(result.pending).toBeUndefined();
  expect(result.logs).toHaveLength(1);
  const saved = await db.characters.get(c.id);
  expect(saved?.birthday).toEqual({ month: 4, day: 2 });
  expect(saved?.presets).toEqual(c.presets);
});
