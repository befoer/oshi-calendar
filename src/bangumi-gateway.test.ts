import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  searchBangumi,
  detailBangumi,
  fetchBangumiCharacter,
  birthdayCandidate,
} from "./bangumi";
import { setBangumiConnection } from "./bangumi-connection";

afterEach(() => {
  setBangumiConnection("gateway");
  vi.unstubAllGlobals();
});
const origin = "https://bangumi-api.acg-dna.top";
const character = {
  id: 72355,
  name: "イレイナ",
  birth_mon: 10,
  birth_day: 17,
  infobox: [
    { key: "简体中文名", value: "伊蕾娜" },
    { key: "生日", value: "10月17日" },
    { key: "别名", value: [{ k: "英文名", v: "Elaina" }] },
  ],
};

it("网关完整搜索保留生日和英文别名，不直连 Bangumi", async () => {
  const request = vi.fn(async (input: unknown, init: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("kind")).toBe("character");
    expect(url.searchParams.get("query")).toBe("伊蕾娜");
    expect(init.body).toBeUndefined();
    return Response.json({ data: [character], results: [] });
  });
  vi.stubGlobal("fetch", request);
  const results = await searchBangumi("伊蕾娜");
  expect(results).toEqual([character]);
  expect(birthdayCandidate(results[0])).toMatchObject({
    month: 10,
    day: 17,
    valid: true,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it("通过网关按编号读取角色详情和作品", async () => {
  const request = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(origin);
    return Response.json(
      url.pathname.endsWith("/subjects")
        ? [{ name_cn: "魔女之旅" }]
        : character,
    );
  });
  vi.stubGlobal("fetch", request);
  expect(await detailBangumi(72355)).toEqual({
    ...character,
    works: ["魔女之旅"],
  });
  expect(
    request.mock.calls.map(([input]) => new URL(String(input)).pathname).sort(),
  ).toEqual(["/v1/characters/72355", "/v1/characters/72355/subjects"]);
});

it("空搜索结果正常返回，不触发其他网络请求", async () => {
  const request = vi.fn(async () => Response.json({ data: [], results: [] }));
  vi.stubGlobal("fetch", request);
  expect(await searchBangumi("不存在的角色")).toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
});

it("网关不可用时仍可读取完整角色资料", async () => {
  const request = vi.fn(async (input: unknown) => {
    if (String(input).startsWith(origin))
      throw new TypeError("Failed to fetch");
    expect(String(input)).toBe("https://api.bgm.tv/v0/characters/72355");
    return Response.json(character);
  });
  vi.stubGlobal("fetch", request);
  expect(await fetchBangumiCharacter(72355)).toEqual(character);
});

it("网关限流直接提示，不再向其他路径重试", async () => {
  const request = vi.fn(async () =>
    Response.json({ error: "搜索请求过于频繁" }, { status: 429 }),
  );
  vi.stubGlobal("fetch", request);
  await expect(searchBangumi("伊蕾娜")).rejects.toThrow("请求过于频繁");
  expect(request).toHaveBeenCalledTimes(1);
});

it("手动直连时搜索、详情和作品均跳过网关", async () => {
  setBangumiConnection("direct");
  const request = vi.fn(async (input: unknown) => {
    const url = String(input);
    expect(url.startsWith("https://api.bgm.tv/v0/")).toBe(true);
    return Response.json(
      url.includes("/search/")
        ? { data: [character] }
        : url.endsWith("/subjects")
          ? [{ name_cn: "测试作品" }]
          : { ...character, id: 424242 },
    );
  });
  vi.stubGlobal("fetch", request);
  expect(await searchBangumi("伊蕾娜")).toEqual([character]);
  expect(await detailBangumi(424242)).toMatchObject({
    id: 424242,
    works: ["测试作品"],
  });
  expect(request).toHaveBeenCalledTimes(3);
});

it("切换直连立即取消挂起的网关请求，不等待网关超时或启动旧请求回退", async () => {
  const request = vi.fn(
    (_input: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", request);
  const pending = searchBangumi("伊蕾娜");
  setBangumiConnection("direct");
  await expect(pending).rejects.toThrow("Aborted");
  expect(request).toHaveBeenCalledTimes(1);
});
