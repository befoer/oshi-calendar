import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { searchAniListPortraits } from "./anilist";

afterEach(() => vi.unstubAllGlobals());
const bangumi = {
  id: 72355,
  name: "イレイナ",
  infobox: [{ key: "别名", value: [{ k: "英文名", v: "Elaina" }] }],
};
const anilist = {
  id: 127535,
  name: { full: "Elaina", native: "イレイナ", alternative: [] },
  image: {
    large: "https://s4.anilist.co/file/anilistcdn/character/large/elaina.jpg",
    medium: null,
  },
};

it("已展开角色按原名获取 AniList 头像，过滤无关候选且不再查询 Bangumi", async () => {
  const request = vi.fn(async (source: string, init: RequestInit) => {
    expect(source).toBe("https://graphql.anilist.co");
    expect(JSON.parse(String(init.body)).variables.search).toBe("イレイナ");
    return Response.json({
      data: {
        Page: {
          characters: [
            anilist,
            {
              ...anilist,
              id: 127536,
              image: {
                ...anilist.image,
                large: "https://s4.anilist.co/second.jpg",
              },
            },
            { ...anilist, id: 99, name: { full: "Other", native: "別人" } },
          ],
        },
      },
    });
  });
  vi.stubGlobal("fetch", request);
  const result = await searchAniListPortraits(bangumi);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: anilist.id,
    provider: "anilist",
    images: { medium: anilist.image.large },
  });
  expect(request).toHaveBeenCalledOnce();
});

it("原名没有匹配头像时再尝试这个角色的英文别名", async () => {
  const searches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_source: string, init: RequestInit) => {
      const name = JSON.parse(String(init.body)).variables.search;
      searches.push(name);
      return Response.json({
        data: { Page: { characters: name === "Elaina" ? [anilist] : [] } },
      });
    }),
  );
  expect(await searchAniListPortraits(bangumi)).toHaveLength(1);
  expect(searches).toEqual(["イレイナ", "Elaina"]);
});

it("备选头像失败不弹网络弹窗，仍由预览保留 Bangumi 资料", async () => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("offline");
    }),
  );
  await expect(searchAniListPortraits(bangumi)).rejects.toThrow();
  expect(dispatchEvent).not.toHaveBeenCalled();
});

it("关闭预览取消 AniList 请求，不再启动本机回退", async () => {
  const controller = new AbortController();
  const dispatchEvent = vi.fn();
  vi.stubGlobal("location", { hostname: "127.0.0.1" });
  vi.stubGlobal("window", { dispatchEvent });
  const request = vi.fn(
    (_source: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", request);
  const pending = searchAniListPortraits(bangumi, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("Aborted");
  expect(request).toHaveBeenCalledOnce();
  expect(dispatchEvent).not.toHaveBeenCalled();
});
