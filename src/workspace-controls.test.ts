import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  defaults,
  newCharacter,
  stamp,
  characterSchema,
  type Data,
} from "./domain";
import {
  occurrences,
  holidayKey,
  localRecommendations,
  upcomingHolidays,
  toICS,
} from "./calendar";
import { automaticBirthdayUpdate, mergeBangumi } from "./bangumi";
import { birthdayFromSnapshot } from "./birthday-data";
import {
  db,
  repository,
  put,
  exportBackup,
  importBackup,
  restoreBirthdaySnapshot,
} from "./store";
import {
  completion,
  prepareChanges,
  generateRecommendations,
  type AIConfig,
} from "./ai";

const config: AIConfig = {
  endpoint: "https://test.example/v1",
  key: "secret",
  model: "model",
  remember: false,
  mode: "tools",
};
beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put(defaults);
});
afterEach(() => vi.unstubAllGlobals());

it("节日排除后按日期补齐5项，可跨30天和跨年，保持筛选且不重复年度节日", async () => {
  const data = await repository.snapshot();
  const before = upcomingHolidays(data, "2026-10-10", "holiday");
  expect(before).toHaveLength(5);
  expect(before.at(-1)!.date > "2026-11-09").toBe(true);
  data.settings = { ...defaults, excludedHolidays: [holidayKey(before[0])] };
  const after = upcomingHolidays(data, "2026-10-10", "holiday");
  expect(after).toHaveLength(5);
  expect(after.slice(0, 4)).toEqual(before.slice(1));
  expect(after[4].date > before[4].date).toBe(true);
  expect(after.every((e) => e.id.startsWith("holiday:"))).toBe(true);
  expect(new Set(after.map(holidayKey)).size).toBe(5);
  expect(
    upcomingHolidays(data, "2026-10-10", "holiday", true).some(
      (e) => e.id === before[0].id,
    ),
  ).toBe(true);
  expect(upcomingHolidays(data, "2026-12-26")[0].date.startsWith("2027-")).toBe(
    true,
  );
});

it("旧节日题材Tag不进入推荐或ICS，日期和主题继续保留", async () => {
  const data = await repository.snapshot();
  data.events = [
    {
      ...stamp(),
      title: "旧节日",
      recurrence: "solar",
      date: "2026-11-11",
      month: 11,
      day: 11,
      reminderDays: 14,
      tags: "legacy_theme_keyword",
      notes: "保留备注",
    },
  ];
  expect(
    localRecommendations(data, "2026-10-10").every((r) => r.tags === ""),
  ).toBe(true);
  const items = occurrences(data, "2026-10-10", "2027-10-10");
  expect(items.every((e) => e.tags === "")).toBe(true);
  expect(toICS(items)).not.toContain("legacy_theme_keyword");
  expect(toICS(items)).toContain("保留备注");
});

it("AI推荐无需题材Tag，模型仍返回旧字段时忽略且不发角色预设", async () => {
  const data = await repository.snapshot();
  const character = newCharacter("角色", "verbatim_character_tag");
  data.characters = [character];
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    title: "冬日创作",
                    dateStart: "2026-12-01",
                    dateEnd: "2026-12-31",
                    reason: "季节主题",
                    characterIds: [character.id],
                  },
                  {
                    title: "新年创作",
                    dateStart: "2027-01-01",
                    dateEnd: "2027-01-03",
                    reason: "新年主题",
                    characterIds: [],
                    tags: "obsolete_theme",
                  },
                ]),
              },
            },
          ],
        }),
      );
    }),
  );
  const result = await generateRecommendations(
    config,
    data,
    "2026-10-10",
    "2027-01-10",
    [character.id],
  );
  expect(result).toHaveLength(2);
  expect(result.every((r) => r.tags === "")).toBe(true);
  const input = JSON.parse(bodies[0].messages[1].content);
  expect(input.localThemes.every((r: any) => !("tags" in r))).toBe(true);
  expect(input.characters[0]).not.toHaveProperty("preset");
});

it("排除节日跨年生效，提醒、推荐与导出使用同一过滤；备份恢复可还原", async () => {
  const data = await repository.snapshot();
  const event = {
    ...stamp(),
    title: "自定义周年",
    recurrence: "solar" as const,
    date: "2026-11-11",
    month: 11,
    day: 11,
    reminderDays: 14,
    tags: "festive",
    notes: "",
  };
  data.events.push(event);
  const all = occurrences(data, "2026-10-01", "2027-12-31");
  const halloween = all.find((e) => e.title === "万圣节")!;
  const custom = all.find((e) => e.title === event.title)!;
  data.settings = {
    ...defaults,
    excludedHolidays: [holidayKey(halloween), holidayKey(custom)],
  };
  expect(
    occurrences(data, "2026-10-01", "2027-12-31").some((e) =>
      [halloween.title, custom.title].includes(e.title),
    ),
  ).toBe(false);
  expect(
    occurrences(data, "2026-10-01", "2027-12-31", true).filter(
      (e) => e.title === halloween.title,
    ),
  ).toHaveLength(2);
  expect(
    localRecommendations(data, "2026-10-01").some(
      (e) => e.title === halloween.title,
    ),
  ).toBe(false);
  await put("settings", data.settings);
  await put("events", event);
  const backup = await exportBackup();
  await db.settings.put(defaults);
  await importBackup(backup);
  expect((await repository.snapshot()).settings.excludedHolidays).toEqual(
    data.settings.excludedHolidays,
  );
});

it("无生日不会被自动资料、导入或内置快照填回，仍参与季节推荐且可备份恢复", async () => {
  const character = {
    ...newCharacter("测试角色"),
    bangumiId: 183099,
    birthdayConfidence: "none" as const,
  };
  const remote = {
    id: 183099,
    name: character.name,
    birth_mon: 7,
    birth_day: 20,
    images: { medium: "https://example.test/avatar.png" },
    infobox: [{ key: "生日", value: "7月20日" }],
  };
  const next = automaticBirthdayUpdate(character, remote, "2026-10-10");
  expect(next.birthday).toBeNull();
  expect(next.birthdayConfidence).toBe("none");
  expect(next.avatarUrl).toBe(remote.images.medium);
  expect(mergeBangumi(character, remote, true).birthday).toBeNull();
  expect(birthdayFromSnapshot(character)).toBeNull();
  expect(
    characterSchema.safeParse({ ...character, birthday: { month: 7, day: 20 } })
      .success,
  ).toBe(false);
  await put("characters", next);
  await restoreBirthdaySnapshot();
  const data = await repository.snapshot();
  expect(
    occurrences(data, "2026-01-01", "2027-12-31").filter(
      (e) => e.type === "birthday",
    ),
  ).toHaveLength(0);
  expect(
    localRecommendations(data).some((e) =>
      e.characterIds.includes(character.id),
    ),
  ).toBe(true);
  const backup = await exportBackup();
  await db.characters.clear();
  await importBackup(backup);
  expect((await repository.snapshot()).characters[0].birthdayConfidence).toBe(
    "none",
  );
});

it("AI 无生日编辑和恢复待确认使用统一校验，矛盾日期不执行", async () => {
  const character = newCharacter("角色");
  const data: Data = {
    ...(await repository.snapshot()),
    characters: [character],
  };
  const changes = (patch: unknown) => ({
    summary: "无生日设置",
    changes: [
      {
        collection: "characters",
        action: "put",
        id: character.id,
        data: patch,
      },
    ],
  });
  const result = prepareChanges(changes({ noBirthday: true }), data, "none");
  expect(result.reasons).toEqual([]);
  expect(result.operations[0].record).toMatchObject({
    birthdayConfidence: "none",
    birthday: null,
  });
  expect(() =>
    prepareChanges(
      changes({ noBirthday: true, birthday: { month: 1, day: 1 } }),
      data,
      "invalid",
    ),
  ).toThrow("不能同时");
  data.characters[0] = result.operations[0].record as typeof character;
  expect(
    prepareChanges(changes({ noBirthday: false }), data, "restore")
      .operations[0].record,
  ).toMatchObject({ birthdayConfidence: "unknown" });
});

it("默认不发送思考参数，指定强度发送且上游拒绝时提示恢复默认", async () => {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      );
    }),
  );
  await completion(config, []);
  await completion({ ...config, reasoningEffort: "high" }, []);
  expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  expect(bodies[1].reasoning_effort).toBe("high");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          '{"error":{"message":"Unsupported parameter: reasoning_effort"}}',
          { status: 400 },
        ),
    ),
  );
  await expect(
    completion({ ...config, reasoningEffort: "high" }, [], []),
  ).rejects.toThrow("切换为默认");
});
