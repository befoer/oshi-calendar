import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { filterBirthdayRanking, loadBirthdayRanking } from "./birthday-ranking";

const storage = new Map<string, string>();
const character = (id: number, favourites: number, month = 10, day = 29) => ({
  id,
  favourites,
  gender: id % 2 ? "Female" : "Male",
  name: { full: `Character ${id}`, native: `角色 ${id}` },
  image: {
    large: "https://s4.anilist.co/file/anilistcdn/character/large/test.jpg",
    medium: null,
  },
  dateOfBirth: { year: null, month, day },
  media: {
    nodes: [{ title: { native: "原作", english: "Work", romaji: null } }],
  },
});
const respond = (characters: unknown[]) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: { Page: { characters, pageInfo: { hasNextPage: false } } },
        }),
      ),
  );
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("取得完整生日榜，按收藏人数排序后再筛选性别", async () => {
  const fetcher = respond([
    character(3, 5),
    character(2, 90),
    character(1, 100),
    character(4, 4),
    character(5, 3),
    character(6, 2),
  ]);
  vi.stubGlobal("fetch", fetcher);
  const { entries } = await loadBirthdayRanking("2026-10-29");
  expect(entries.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(filterBirthdayRanking(entries, "female").map((c) => c.id)).toEqual([
    1, 3, 5,
  ]);
  expect(filterBirthdayRanking(entries, "male").map((c) => c.id)).toEqual([
    2, 4, 6,
  ]);
  expect(filterBirthdayRanking(entries, "all")).toHaveLength(6);
  expect(entries[0]).toMatchObject({
    name: "角色 1",
    work: "原作",
    favourites: 100,
  });
  const [url, init] = (
    fetcher.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe("https://graphql.anilist.co");
  const request = JSON.parse(String(init.body));
  expect(request.variables).toEqual({ birthday: true, page: 1 });
  expect(request.query).toContain(
    "isBirthday: $birthday, sort: FAVOURITES_DESC",
  );
  expect(request.query).toContain("Page(page: $page, perPage: 50)");
  expect(request.query).toContain("gender");
});

it("生日源跨日未同步时拒绝展示昨天的榜单，不写入缓存", async () => {
  vi.stubGlobal("fetch", respond([character(1, 100, 10, 28)]));
  await expect(loadBirthdayRanking("2026-10-29")).rejects.toThrow(
    "北京时间今天同步",
  );
  expect(storage.size).toBe(0);
});

it("当天一小时内复用排名，手动刷新会重新获取收藏数", async () => {
  const fetcher = respond([character(1, 100)]);
  vi.stubGlobal("fetch", fetcher);
  await loadBirthdayRanking("2026-10-29");
  await loadBirthdayRanking("2026-10-29");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(respond([character(1, 120)]));
  expect(
    (await loadBirthdayRanking("2026-10-29", undefined, true)).entries[0]
      .favourites,
  ).toBe(120);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("离线时可展示当天缓存并提示，隔天不复用旧寿星", async () => {
  vi.stubGlobal("fetch", respond([character(1, 100)]));
  await loadBirthdayRanking("2026-10-29");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 })),
  );
  const result = await loadBirthdayRanking("2026-10-29", undefined, true);
  expect(result.entries[0].id).toBe(1);
  expect(result.warning).toContain("今天缓存");
  await expect(loadBirthdayRanking("2026-10-30")).rejects.toThrow("503");
});

it("空结果与不足五人时保留实际人数，损坏的收藏数据不伪装成人气零", async () => {
  vi.stubGlobal("fetch", respond([]));
  expect((await loadBirthdayRanking("2026-10-29")).entries).toEqual([]);
  vi.stubGlobal("fetch", respond([character(1, 100), character(2, 20)]));
  expect(
    (await loadBirthdayRanking("2026-10-29", undefined, true)).entries,
  ).toHaveLength(2);
  storage.clear();
  vi.stubGlobal("fetch", respond([{ ...character(1, 100), favourites: null }]));
  await expect(loadBirthdayRanking("2026-10-29")).rejects.toThrow();
});

it("取消的请求不会保存榜单或回退到缓存", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      controller.abort();
      return new Response(
        JSON.stringify({
          data: {
            Page: {
              characters: [character(1, 100)],
              pageInfo: { hasNextPage: false },
            },
          },
        }),
      );
    }),
  );
  await expect(
    loadBirthdayRanking("2026-10-29", controller.signal),
  ).rejects.toThrow();
  expect(storage.size).toBe(0);
});

it("继续读取后续分页，性别筛选包含原前五名之后的角色；未标性别只计入全部", async () => {
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    const page = JSON.parse(String(init.body)).variables.page;
    return new Response(
      JSON.stringify({
        data: {
          Page: {
            pageInfo: { hasNextPage: page === 1 },
            characters:
              page === 1
                ? [2, 4, 6, 8, 10].map((id) => character(id, 200 - id))
                : [character(11, 100), { ...character(12, 90), gender: null }],
          },
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const { entries } = await loadBirthdayRanking("2026-10-29");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(entries).toHaveLength(7);
  expect(filterBirthdayRanking(entries, "female").map((c) => c.id)).toEqual([
    11,
  ]);
  expect(filterBirthdayRanking(entries, "male")).toHaveLength(5);
});

it("分页中途失败不缓存不完整的人气榜", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const page = JSON.parse(String(init.body)).variables.page;
      return page === 1
        ? new Response(
            JSON.stringify({
              data: {
                Page: {
                  pageInfo: { hasNextPage: true },
                  characters: [character(1, 100)],
                },
              },
            }),
          )
        : new Response("{}", { status: 503 });
    }),
  );
  await expect(loadBirthdayRanking("2026-10-29")).rejects.toThrow("503");
  expect(storage.size).toBe(0);
});
