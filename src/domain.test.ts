import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ICAL from "ical.js";
import {
  automaticBirthdayUpdate,
  birthdayCandidate,
  syncBirthdays,
} from "./bangumi";
import { defaults, newCharacter, compose, stamp, type Data } from "./domain";
import { seedCharacters } from "./seed";
import { birthdayFromSnapshot } from "./birthday-data";
import { normalizeAniList, matchAniList } from "./anilist";
import {
  db,
  repository,
  exportBackup,
  importBackup,
  validateBackup,
  initialize,
} from "./store";
import {
  birthdayDate,
  occurrences,
  lunarDate,
  localRecommendations,
  toICS,
} from "./calendar";
import {
  prepareChanges,
  applyPending,
  runAssistant,
  generateRecommendations,
  fetchModels,
  selectedModels,
  loadConfig,
  saveConfig,
  type AIConfig,
} from "./ai";
const empty = (): Data => ({
  characters: [],
  events: [],
  tasks: [],
  recommendations: [],
  settings: defaults,
});
const config: AIConfig = {
  endpoint: "https://example.test/v1",
  key: "test-key",
  model: "test-model",
  remember: false,
  mode: "tools",
};
describe("上游模型与配置", () => {
  it("获取上游模型带鉴权且去重排序，非法和失败响应不替换已选模型", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-b" }],
          }),
        ),
    );
    vi.stubGlobal("fetch", request);
    expect(
      await fetchModels({
        endpoint: "https://example.test/v1/",
        key: "session-secret",
      }),
    ).toEqual(["model-a", "model-b"]);
    expect(request.mock.calls[0]).toEqual([
      "https://example.test/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-secret",
        }),
      }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(fetchModels(config)).rejects.toThrow("密钥无效");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 123 }] }))),
    );
    await expect(fetchModels(config)).rejects.toThrow("格式无效");
    await expect(
      fetchModels({ ...config, endpoint: "javascript:alert(1)" }),
    ).rejects.toThrow("HTTP");
  });
  it("旧单模型配置兼容，多模型持久化且会话密钥不落本机配置", () => {
    const local = new Map<string, string>();
    const session = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    try {
      local.set(
        "huiqi-ai-config",
        JSON.stringify({ ...config, key: "", model: "legacy" }),
      );
      expect(loadConfig().models).toEqual(["legacy"]);
      saveConfig({
        ...config,
        key: "session-secret",
        models: ["model-a", "model-b"],
        model: "model-b",
      });
      expect(loadConfig()).toMatchObject({
        model: "model-b",
        models: ["model-a", "model-b"],
        key: "session-secret",
      });
      expect(local.get("huiqi-ai-config")).not.toContain("session-secret");
      expect(
        selectedModels({ model: "manual", models: ["manual", "model-a", ""] }),
      ).toEqual(["manual", "model-a"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put(defaults);
});
describe("日历和原始 tag", () => {
  it("AniList备用校验月日、同名作品和生日冲突", () => {
    const ani = normalizeAniList({
      id: 999,
      name: { full: "Beatrice", native: "ベアトリス", alternative: [] },
      dateOfBirth: { year: null, month: 1, day: 10 },
      media: {
        nodes: [
          {
            title: {
              romaji: "Re:Zero kara Hajimeru Isekai Seikatsu",
              english: null,
              native: null,
            },
          },
        ],
      },
    });
    const beatrice = seedCharacters()[2];
    expect(matchAniList(beatrice, [ani])?.id).toBe(999);
    expect(matchAniList(beatrice, [ani, { ...ani, id: 1000 }])).toBeNull();
    expect(
      matchAniList(beatrice, [{ ...ani, works: ["Other anime"] }]),
    ).toBeNull();
    const next = automaticBirthdayUpdate(beatrice, ani, "2026-10-10T00:00:00Z");
    expect(next.anilistId).toBe(999);
    expect(next.birthday).toEqual({ month: 1, day: 10 });
    expect(next.birthdaySource).toContain("https://anilist.co/character/999");
    expect(
      automaticBirthdayUpdate(
        { ...beatrice, birthdayConfidence: "uncertain" },
        ani,
        "now",
      ).birthday,
    ).toBeNull();
    expect(
      birthdayCandidate(
        normalizeAniList({
          id: 998,
          name: { full: "Year only", native: null },
          dateOfBirth: { year: 100, month: null, day: null },
        }),
      ).valid,
    ).toBe(false);
  });
  it("Bangumi失败后自动使用AniList，同时保留原始Tag", async () => {
    const c = seedCharacters()[2];
    await db.characters.put(c);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("api.bgm.tv"))
          throw new TypeError("Failed to fetch");
        return new Response(
          JSON.stringify({
            data: {
              Page: {
                characters: [
                  {
                    id: 999,
                    name: { full: "Beatrice", native: "ベアトリス" },
                    dateOfBirth: { year: null, month: 1, day: 10 },
                    media: {
                      nodes: [
                        {
                          title: {
                            romaji: "Re:Zero kara Hajimeru Isekai Seikatsu",
                            english: null,
                            native: null,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        );
      }),
    );
    const result = await syncBirthdays();
    expect(result).toMatchObject({ updated: 1, failed: 0, fallback: 1 });
    const saved = await db.characters.get(c.id);
    expect(saved?.bangumiId).toBe(c.bangumiId);
    expect(saved?.anilistId).toBe(999);
    expect(saved?.presets).toEqual(c.presets);
  });
  it("启动时离线补齐已核对资料，已有生日和冲突不覆盖", async () => {
    const characters = seedCharacters();
    const manual = characters[1];
    manual.birthday = { month: 1, day: 2 };
    manual.birthdayConfidence = "confirmed";
    const uncertain = characters[3];
    uncertain.birthdayConfidence = "uncertain";
    uncertain.birthdaySource = "手动待核对";
    await db.characters.bulkPut(characters);
    await Promise.all([initialize(), initialize()]);
    const saved = (await repository.snapshot()).characters;
    expect(saved.filter((c) => c.birthday)).toHaveLength(13);
    expect(saved.find((c) => c.id === manual.id)?.birthday).toEqual({
      month: 1,
      day: 2,
    });
    expect(saved.find((c) => c.id === uncertain.id)?.birthday).toBeNull();
    const chino = saved.find((c) => c.bangumiId === 23648)!;
    expect(chino.birthday).toEqual({ month: 12, day: 4 });
    expect(chino.birthdaySource).toContain("内置已核对资料（2026-10-10）");
    expect(chino.presets).toEqual(characters[15].presets);
    expect(birthdayFromSnapshot(newCharacter("未关联角色"))).toBeNull();
    const logs = await db.logs.count();
    await initialize();
    expect(await db.logs.count()).toBe(logs);
  });
  it("Bangumi 请求超时返回明确原因", async () => {
    const c = newCharacter("联网角色");
    c.bangumiId = 1;
    await db.characters.put(c);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("signal timed out", "TimeoutError");
      }),
    );
    const result = await syncBirthdays();
    expect(result.failed).toBe(1);
    expect(result.errors.join("；")).toContain("Bangumi 请求超时");
    expect(result.errors.join("；")).toContain("未取得角色英文名");
    expect((await db.characters.get(c.id))?.birthday).toBeNull();
  });
  it("预置伊莉雅关联魔法少女版本", () => {
    expect(seedCharacters()[1].bangumiId).toBe(183099);
  });
  it("自动采用一致月日，冲突与缺失保持待确认，手动日期保留", () => {
    const c = newCharacter("角色");
    const stamp = "2026-10-10T00:00:00Z";
    const valid = {
      id: 1,
      name: "角色",
      birth_mon: 12,
      birth_day: 4,
      infobox: [{ key: "生日", value: "12月4日" }],
    };
    const result = automaticBirthdayUpdate(c, valid, stamp);
    expect(result.birthday).toEqual({ month: 12, day: 4 });
    expect(result.birthdayConfidence).toBe("confirmed");
    expect(result.birthdayFetchedAt).toBe(stamp);
    const conflict = automaticBirthdayUpdate(
      c,
      { ...valid, infobox: [{ key: "生日", value: "甲龙历373年" }] },
      stamp,
    );
    expect(conflict.birthday).toBeNull();
    expect(conflict.birthdayConfidence).toBe("uncertain");
    expect(
      birthdayCandidate({ ...valid, birth_mon: 2, birth_day: 30, infobox: [] })
        .valid,
    ).toBe(false);
    expect(
      automaticBirthdayUpdate(
        {
          ...c,
          birthday: { month: 1, day: 1 },
          birthdayConfidence: "confirmed",
        },
        valid,
        stamp,
      ).birthday,
    ).toEqual({ month: 1, day: 1 });
  });
  it("后台同步补齐并记录来源，同一天不重复请求", async () => {
    const c = newCharacter("角色");
    c.bangumiId = 1;
    await db.characters.put(c);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 1,
              name: "角色",
              birth_mon: 12,
              birth_day: 4,
              infobox: [{ key: "生日", value: "12月4日" }],
            }),
          ),
      ),
    );
    expect((await syncBirthdays()).updated).toBe(1);
    expect((await db.characters.get(c.id))?.birthday).toEqual({
      month: 12,
      day: 4,
    });
    await syncBirthdays();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("旧备份缺少主题和获取时间时兼容默认", () => {
    const c = newCharacter("旧角色");
    const { birthdayFetchedAt, ...old } = c;
    const { theme, ...settings } = defaults;
    const b = validateBackup({
      schemaVersion: 1,
      exportedAt: "2026-10-10",
      characters: [old],
      events: [],
      tasks: [],
      recommendations: [],
      settings,
    });
    expect(b.settings.theme).toBe("system");
    expect(b.characters[0].birthdayFetchedAt).toBe("");
  });
  it("保留17个角色、原始转义与权重、多个形态", () => {
    const chars = seedCharacters();
    expect(chars).toHaveLength(17);
    expect(chars[0].presets[0].positive).toBe(
      "Roxy migurdia, ( jitome:0.8),  frills, dress, white dress, ahoge, bare shoulders",
    );
    expect(chars[2].presets[0].positive).toBe("beatrice \\(re:zero\\)");
    expect(chars[5].presets).toHaveLength(2);
    expect(compose(chars[2].presets[0].positive, "winter")).toBe(
      "beatrice \\(re:zero\\), winter",
    );
  });
  it("跨年与闰日正确，未知生日不产生事项", () => {
    const data = empty();
    const c = newCharacter("测试");
    c.birthday = { month: 1, day: 2 };
    c.birthdayConfidence = "confirmed";
    data.characters = [c, newCharacter("未知")];
    const list = occurrences(data, "2026-12-30", "2027-01-03").filter(
      (e) => e.type === "birthday",
    );
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe("2027-01-02");
    expect(birthdayDate(2027, 2, 29)).toBe("2027-02-28");
    expect(birthdayDate(2028, 2, 29)).toBe("2028-02-29");
  });
  it("农历节日与全部24个节气按实际日期计算", () => {
    expect(lunarDate(2027, 1, 1)).toBe("2027-02-06");
    expect(lunarDate(2026, 8, 15)).toBe("2026-09-25");
    const list = occurrences(empty(), "2026-01-01", "2026-12-31");
    expect(list.filter((e) => e.note === "二十四节气")).toHaveLength(24);
    expect(list.find((e) => e.title === "冬至")?.date).toBe("2026-12-22");
  });
  it("季节推荐涵盖12个月，未知生日可参与", () => {
    const d = empty();
    d.characters = [newCharacter("测试")];
    const list = localRecommendations(d, "2026-10-10");
    const months = list.filter((r) => /^local:\d{4}-\d{2}$/.test(r.id));
    expect(months).toHaveLength(13);
    expect(months.at(-1)?.dateEnd).toBe("2027-10-09");
    expect(months[0].characterIds).toEqual([d.characters[0].id]);
  });
  it("ICS 可解析、年度事件去重、提醒和中文长行正确", () => {
    const d = empty();
    const c = newCharacter("测试".repeat(50));
    c.birthday = { month: 12, day: 5 };
    c.birthdayConfidence = "confirmed";
    d.characters = [c];
    const text = toICS(occurrences(d, "2026-10-10", "2028-10-10"));
    expect(
      text.split("\r\n").every((s) => new TextEncoder().encode(s).length <= 75),
    ).toBe(true);
    const component = new ICAL.Component(ICAL.parse(text));
    const birthdays = component
      .getAllSubcomponents("vevent")
      .filter((c) =>
        String(c.getFirstPropertyValue("summary")).includes("生日"),
      );
    expect(birthdays).toHaveLength(1);
    expect(birthdays[0].getFirstPropertyValue("rrule")?.toString()).toBe(
      "FREQ=YEARLY",
    );
    expect(
      birthdays[0]
        .getFirstSubcomponent("valarm")
        ?.getFirstPropertyValue("trigger")
        ?.toString(),
    ).toBe("-P14D");
  });
});
describe("数据事务与备份", () => {
  it("整批校验失败不留下部分写入", async () => {
    const c = newCharacter("测试");
    await expect(
      repository.apply(
        [
          { collection: "characters", action: "put", record: c },
          {
            collection: "tasks",
            action: "put",
            record: {
              ...stamp(),
              title: "错误引用",
              date: "2026-12-01",
              characterIds: ["missing"],
              status: "todo",
              positive: "",
              negative: "",
              notes: "",
            },
          },
        ],
        "批次",
      ),
    ).rejects.toThrow("引用");
    expect(await db.characters.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
  });
  it("重试去重，支持撤销并检查冲突", async () => {
    const c = newCharacter("测试");
    const first = await repository.apply(
      [{ collection: "characters", action: "put", record: c }],
      "创建",
      "same",
    );
    const second = await repository.apply(
      [{ collection: "characters", action: "put", record: c }],
      "创建",
      "same",
    );
    expect(second.id).toBe(first.id);
    expect(await db.logs.count()).toBe(1);
    await repository.undo(first.id);
    expect(await db.characters.count()).toBe(0);
    await repository.apply(
      [{ collection: "characters", action: "put", record: c }],
      "创建",
      "new",
    );
    await repository.apply(
      [
        {
          collection: "characters",
          action: "put",
          record: { ...c, name: "修改" },
        },
      ],
      "修改",
    );
    await expect(repository.undo("new")).rejects.toThrow("后续修改");
  });
  it("备份恢复和引用验证，不含密钥", async () => {
    await db.characters.bulkPut(seedCharacters());
    const b = await exportBackup();
    expect(JSON.stringify(b)).not.toContain("test-key");
    await db.characters.clear();
    await importBackup(b);
    expect(await db.characters.count()).toBe(17);
    expect(() => validateBackup({ ...b, schemaVersion: 2 })).toThrow();
  });
});
describe("AI 操作约束", () => {
  it("超过50条的提案拒绝执行", () => {
    expect(() =>
      prepareChanges(
        {
          summary: "过大批次",
          changes: Array.from({ length: 51 }, (_, i) => ({
            collection: "characters",
            action: "put",
            data: { name: "角色" + i },
          })),
        },
        empty(),
        "limit",
      ),
    ).toThrow();
  });
  it("添加角色：系统提示要求先查 Bangumi 和 Danbooru；lookup_character_tags 返回生图写法的候选", async () => {
    let round = 0;
    let systemPrompt = "";
    let toolResult = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("danbooru.donmai.us/tags.json"))
          return new Response(
            JSON.stringify([{ name: "roxy_migurdia", post_count: 2400 }]),
          );
        if (String(url).includes("related_tag"))
          return new Response(
            JSON.stringify({
              related_tags: [
                { tag: { name: "blue_hair", category: 0 }, frequency: 0.8 },
              ],
            }),
          );
        const body = JSON.parse(String((init as RequestInit).body));
        round++;
        if (round === 1) systemPrompt = body.messages[0].content;
        if (round === 2) toolResult = body.messages.at(-1).content;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message:
                  round === 1
                    ? {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "tags",
                            type: "function",
                            function: {
                              name: "lookup_character_tags",
                              arguments: '{"names":["Roxy Migurdia"]}',
                            },
                          },
                        ],
                      }
                    : { role: "assistant", content: "完成" },
              },
            ],
          }),
        );
      }),
    );
    await runAssistant(config, [], new AbortController().signal, () => {});
    expect(systemPrompt).toContain("添加角色（含批量）默认先查资料再新建");
    expect(systemPrompt).toContain("用户明确要求直接创建");
    expect(systemPrompt).toContain("lookup_character_tags");
    expect(JSON.parse(toolResult)).toMatchObject({
      source: "Danbooru",
      candidates: [
        { tag: "roxy migurdia", traits: "blue hair", posts: 2400 },
      ],
    });
  });
  it("Bangumi生日来源冲突暂停导入", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("api.bgm.tv"))
          return new Response(
            JSON.stringify(
              String(url).includes("subjects")
                ? [{ name_cn: "作品" }]
                : {
                    id: 123,
                    name: "候选",
                    birth_mon: 3,
                    birth_day: 3,
                    infobox: [{ key: "生日", value: "虚构历373年" }],
                  },
            ),
          );
        round++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "candidate",
                      type: "function",
                      function: {
                        name: "propose_bangumi_import",
                        arguments: '{"bangumiId":123}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }),
    );
    const r = await runAssistant(
      config,
      [],
      new AbortController().signal,
      () => {},
    );
    expect(r.pending).toBeDefined();
    expect(r.pending?.reasons.join()).toContain("冲突");
    expect(await db.characters.count()).toBe(0);
    expect((r.pending?.operations[0].record as any).birthday).toBeNull();
  });
  it("重复tool call id不会重复创建", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        round++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message:
                  round <= 2
                    ? {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "same-call",
                            type: "function",
                            function: {
                              name: "apply_changes",
                              arguments: JSON.stringify({
                                summary: "新增",
                                changes: [
                                  {
                                    collection: "characters",
                                    action: "put",
                                    data: { name: "唯一角色" },
                                  },
                                ],
                              }),
                            },
                          },
                        ],
                      }
                    : { role: "assistant", content: "完成" },
              },
            ],
          }),
        );
      }),
    );
    await runAssistant(config, [], new AbortController().signal, () => {});
    expect(await db.characters.count()).toBe(1);
    expect(await db.logs.count()).toBe(1);
  });
  it("工具参数里的对象被写成JSON字符串时仍能保存", async () => {
    let round = 0;
    const settingsCall = (args: string) => ({
      id: "call-" + round,
      type: "function",
      function: { name: "apply_changes", arguments: args },
    });
    const calls = [
      // data 是 JSON 字符串（实际遇到的写法）
      JSON.stringify({
        summary: "默认提醒",
        changes: [
          {
            collection: "settings",
            action: "put",
            data: JSON.stringify({ reminderDays: 7 }),
          },
        ],
      }),
      // 整个参数再被编码一次
      JSON.stringify(
        JSON.stringify({
          summary: "默认提醒",
          changes: JSON.stringify([
            { collection: "settings", action: "put", data: { reminderDays: 5 } },
          ]),
        }),
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        round++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message:
                  round <= calls.length
                    ? {
                        role: "assistant",
                        content: null,
                        tool_calls: [settingsCall(calls[round - 1])],
                      }
                    : { role: "assistant", content: "完成" },
              },
            ],
          }),
        );
      }),
    );
    const r = await runAssistant(
      config,
      [],
      new AbortController().signal,
      () => {},
    );
    expect(r.pending).toBeUndefined();
    // 两次调用都保存成功：先改成 7，再改成 5
    expect(await db.logs.count()).toBe(2);
    expect((await db.settings.get("main"))?.reminderDays).toBe(5);
  });
  it("只在期望对象的位置还原JSON字符串，文本字段原样保留", () => {
    const tag = '{"masterpiece"}';
    const pending = prepareChanges(
      {
        summary: "新增",
        changes: JSON.stringify([
          {
            collection: "characters",
            action: "put",
            data: JSON.stringify({ name: "测试角色", aliases: ["[别名]"] }),
          },
        ]),
      },
      empty(),
      "r",
    );
    expect((pending.operations[0].record as any).name).toBe("测试角色");
    expect((pending.operations[0].record as any).aliases).toEqual(["[别名]"]);
    expect(() =>
      prepareChanges(
        {
          summary: "坏数据",
          changes: [{ collection: "settings", action: "put", data: tag }],
        },
        empty(),
        "r",
      ),
    ).toThrow();
  });
  it("拒绝工具的服务自动回退JSON并保存", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.tools) return new Response("{}", { status: 400 });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    reply: "请确认",
                    proposal: {
                      summary: "默认提醒",
                      changes: [
                        {
                          collection: "settings",
                          action: "put",
                          data: { reminderDays: 7 },
                        },
                      ],
                    },
                  }),
                },
              },
            ],
          }),
        );
      }),
    );
    const r = await runAssistant(
      config,
      [],
      new AbortController().signal,
      () => {},
    );
    expect(r.pending).toBeUndefined();
    expect((await db.settings.get("main"))?.reminderDays).toBe(7);
  });
  it("取消请求不写入", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAssistant(config, [], controller.signal, () => {}),
    ).rejects.toThrow("取消");
    expect(await db.logs.count()).toBe(0);
  });
  it("禁止未知参数、危险设置及不明确日期", () => {
    expect(() =>
      prepareChanges(
        {
          summary: "配置",
          changes: [
            { collection: "settings", action: "put", data: { apiKey: "bad" } },
          ],
        },
        empty(),
        "r",
      ),
    ).toThrow("设置");
    expect(() =>
      prepareChanges(
        {
          summary: "节日",
          changes: [
            {
              collection: "events",
              action: "put",
              data: { title: "日期不明" },
            },
          ],
        },
        empty(),
        "r",
      ),
    ).toThrow("日期不明确");
    expect(() =>
      prepareChanges(
        {
          summary: "任务",
          changes: [
            {
              collection: "tasks",
              action: "put",
              data: { title: "日期不明", date: "2026-02-30" },
            },
          ],
        },
        empty(),
        "r",
      ),
    ).toThrow();
  });
  it("删除需确认，tag及生日明确编辑直接执行，同名添加报错", () => {
    const d = empty(),
      c = newCharacter("测试", "raw");
    d.characters = [c];
    expect(
      prepareChanges(
        {
          summary: "删除",
          changes: [{ collection: "characters", action: "delete", id: c.id }],
        },
        d,
        "r",
      ).reasons,
    ).not.toHaveLength(0);
    expect(
      prepareChanges(
        {
          summary: "tag",
          changes: [
            {
              collection: "characters",
              action: "put",
              id: c.id,
              data: { presets: [{ ...c.presets[0], positive: "new" }] },
            },
          ],
        },
        d,
        "r",
      ).reasons.join(),
    ).toBe("");
    expect(
      prepareChanges(
        {
          summary: "生日",
          changes: [
            {
              collection: "characters",
              action: "put",
              id: c.id,
              data: { birthday: { month: 12, day: 5 } },
            },
          ],
        },
        d,
        "r",
      ).reasons.join(),
    ).toBe("");
    expect(() =>
      prepareChanges(
        {
          summary: "重复",
          changes: [
            { collection: "characters", action: "put", data: { name: "测试" } },
          ],
        },
        d,
        "r",
      ),
    ).toThrow("同名");
  });
  it("确认预览后资料变化禁止覆盖", async () => {
    const c = newCharacter("测试");
    await db.characters.put(c);
    const pending = prepareChanges(
      {
        summary: "修改",
        changes: [
          {
            collection: "characters",
            action: "put",
            id: c.id,
            data: { reminderDays: 7 },
          },
        ],
      },
      await repository.snapshot(),
      "r",
    );
    await db.characters.update(c.id, { name: "变更" });
    await expect(applyPending(pending)).rejects.toThrow("变化");
  });
  it("多步工具调用准确保存，私人备注不发送", async () => {
    const c = newCharacter("测试");
    c.notes = "PRIVATE_NOTE";
    await db.characters.put(c);
    const bodies: any[] = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        calls++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message:
                  calls === 1
                    ? {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "call1",
                            type: "function",
                            function: {
                              name: "apply_changes",
                              arguments: JSON.stringify({
                                summary: "设置提醒",
                                changes: [
                                  {
                                    collection: "characters",
                                    action: "put",
                                    id: c.id,
                                    data: { reminderDays: 7 },
                                  },
                                ],
                              }),
                            },
                          },
                        ],
                      }
                    : { role: "assistant", content: "已设置" },
              },
            ],
          }),
        );
      }),
    );
    const result = await runAssistant(
      config,
      [{ role: "user", content: "提前7天提醒" }],
      new AbortController().signal,
      () => {},
    );
    expect(result.logs).toHaveLength(1);
    expect((await db.characters.get(c.id))?.reminderDays).toBe(7);
    expect(JSON.stringify(bodies)).not.toContain("PRIVATE_NOTE");
  });
  it("JSON兼容模式合法编辑直接写入", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      reply: "待确认",
                      proposal: {
                        summary: "新增角色",
                        changes: [
                          {
                            collection: "characters",
                            action: "put",
                            data: { name: "新角色" },
                          },
                        ],
                      },
                    }),
                  },
                },
              ],
            }),
          ),
      ),
    );
    const r = await runAssistant(
      { ...config, mode: "json" },
      [],
      new AbortController().signal,
      () => {},
    );
    expect(r.pending).toBeUndefined();
    expect(await db.characters.count()).toBe(1);
  });
  it("8轮调用上限停止，非法工具不执行", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: crypto.randomUUID(),
                        type: "function",
                        function: { name: "dangerous_tool", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            }),
          ),
      ),
    );
    const result = await runAssistant(
      config,
      [],
      new AbortController().signal,
      () => {},
    );
    expect(result.text).toContain("8 轮");
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(await db.logs.count()).toBe(0);
  });
  it("越界AI推荐拒绝保存", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify([
                      {
                        title: "错误",
                        dateStart: "2020-01-01",
                        dateEnd: "2020-02-01",
                        reason: "r",
                        tags: "winter",
                        characterIds: [],
                      },
                    ]),
                  },
                },
              ],
            }),
          ),
      ),
    );
    await expect(
      generateRecommendations(config, empty(), "2026-10-10", "2027-01-10", []),
    ).rejects.toThrow("越界");
  });
});
