import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, repository } from "./store";
import { defaults, newCharacter, newPreset, type Data } from "./domain";
import {
  syncBirthdays,
  automaticBirthdayUpdate,
  matchCharacterCandidate,
} from "./bangumi";
import { prepareCharacterTags, applyPending, completion } from "./ai";
import { externalJSON, avatarFallbackURL } from "./external-network";
import { AIStreamError, hasVisibleReply } from "./ai-stream";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put(defaults);
});
afterEach(() => vi.unstubAllGlobals());

it("未关联新角色身份唯一时自动关联、补齐头像生日，保留Tag且可撤销", async () => {
  const character = newCharacter("测试角色");
  character.presets[0].positive = "Tag \\(original\\), (weight:1.2)";
  await db.characters.put(character);
  const remote = {
    id: 42,
    name: "测试角色",
    images: { medium: "https://lain.bgm.tv/avatar.jpg" },
    birth_mon: 7,
    birth_day: 11,
  };
  const fetch = vi.fn(async (url: unknown, init: any) => {
    if (String(url).includes("search")) {
      expect(JSON.parse(init.body).keyword).toBe(character.name);
      return new Response(JSON.stringify({ data: [remote] }));
    }
    return new Response(
      JSON.stringify(
        String(url).endsWith("subjects") ? [{ name_cn: "测试作品" }] : remote,
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const result = await syncBirthdays(true);
  expect(result.candidates).toEqual([]);
  expect(result.linked).toBe(1);
  expect(result.updated).toBe(1);
  expect(result.avatars).toBe(1);
  const saved = await db.characters.get(character.id);
  expect(saved?.bangumiId).toBe(42);
  expect(saved?.birthday).toEqual({ month: 7, day: 11 });
  expect(saved?.avatarUrl).toBe(remote.images.medium);
  expect(saved?.presets).toEqual(character.presets);
  expect(saved?.works).toEqual(["测试作品"]);
  const logs = await db.logs.toArray();
  expect(logs).toHaveLength(1);
  await repository.undo(logs[0].id);
  expect((await db.characters.get(character.id))?.bangumiId).toBeNull();
});

it("自动匹配校验姓名、别名和作品，同名不选第一个；不把模糊搜索视为身份", () => {
  const c = newCharacter("白");
  const a = { id: 1, name: "白", works: ["游戏人生"] };
  const b = { id: 2, name: "白", works: ["火影忍者"] };
  expect(matchCharacterCandidate(c, [a, b])).toBeNull();
  c.works = ["游戏人生"];
  expect(matchCharacterCandidate(c, [a, b])?.id).toBe(1);
  expect(matchCharacterCandidate(c, [b])).toBeNull();
  expect(matchCharacterCandidate(c, [{ ...a, name: "白雪公主" }])).toBeNull();
  c.aliases = ["Shiro"];
  expect(matchCharacterCandidate(c, [{ ...a, name: "Shiro" }])?.id).toBe(1);
  expect(
    matchCharacterCandidate(c, [
      { ...a, name: "白雪", infobox: [{ key: "简体中文名", value: "白" }] },
    ])?.id,
  ).toBe(1);
});

it("同名候选保持未关联；候选读取不完整时不会错误自动关联", async () => {
  const c = newCharacter("重名角色");
  await db.characters.put(c);
  for (const failDetail of [false, true]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("search"))
          return new Response(
            JSON.stringify({
              data: [
                { id: 1, name: c.name },
                { id: 2, name: c.name },
              ],
            }),
          );
        if (String(url).endsWith("subjects")) return new Response("[]");
        if (failDetail && String(url).endsWith("/2"))
          throw new TypeError("fetch failed");
        return new Response(
          JSON.stringify({
            id: Number(String(url).split("/").at(-1)),
            name: c.name,
          }),
        );
      }),
    );
    const result = await syncBirthdays(true);
    expect(result.linked).toBe(0);
    expect(result.candidates[0].results).toHaveLength(2);
    expect(await db.characters.get(c.id)).toEqual(c);
  }
});

it("自动关联AniList备用候选，来源冲突生日仍为空且保留手动资料", async () => {
  const c = newCharacter("Fallback Character");
  c.birthdayConfidence = "uncertain";
  c.birthdaySource = "已有资料冲突";
  c.avatarUrl = "data:image/png;base64,AA==";
  await db.characters.put(c);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("api.bgm.tv"))
        throw new TypeError("fetch failed");
      return new Response(
        JSON.stringify({
          data: {
            Page: {
              characters: [
                {
                  id: 99,
                  name: { full: c.name, native: null },
                  image: { medium: null, large: null },
                  dateOfBirth: { year: null, month: 1, day: 2 },
                  media: { nodes: [] },
                },
              ],
            },
          },
        }),
      );
    }),
  );
  const result = await syncBirthdays(true);
  expect(result.linked).toBe(1);
  expect(result.fallback).toBe(1);
  const saved = await db.characters.get(c.id);
  expect(saved?.anilistId).toBe(99);
  expect(saved?.birthday).toBeNull();
  expect(saved?.birthdayConfidence).toBe("uncertain");
  expect(saved?.birthdaySource).toContain(c.birthdaySource);
  expect(saved?.avatarUrl).toBe(c.avatarUrl);
});

it("已填写生日的关联角色也补齐空头像，保留手动资料及本地图片", async () => {
  const character = newCharacter("已关联角色");
  character.bangumiId = 42;
  character.birthday = { month: 4, day: 1 };
  character.birthdayConfidence = "confirmed";
  character.birthdaySource = "用户手动资料";
  const remote = {
    id: 42,
    name: character.name,
    images: { medium: "https://lain.bgm.tv/avatar.jpg" },
    birth_mon: 7,
    birth_day: 11,
  };
  await db.characters.put(character);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(remote))),
  );
  const result = await syncBirthdays(true);
  expect(result.avatars).toBe(1);
  expect(result.updated).toBe(0);
  expect(result.unresolved).toBe(0);
  const saved = await db.characters.get(character.id);
  expect(saved?.avatarUrl).toBe(remote.images.medium);
  expect(saved?.birthday).toEqual(character.birthday);
  expect(saved?.birthdaySource).toBe(character.birthdaySource);
  const local = { ...character, avatarUrl: "data:image/png;base64,AA==" };
  expect(automaticBirthdayUpdate(local, remote, "today").avatarUrl).toBe(
    local.avatarUrl,
  );
});

it("浏览器直连失败后资料通过本地代理获取，成功时不报网络失败", async () => {
  vi.stubGlobal("location", { hostname: "127.0.0.1" });
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  const fetch = vi.fn(async (url: unknown, init: any) => {
    if (String(url).startsWith("https:")) throw new TypeError("fetch failed");
    expect(url).toBe("/__huiqi_character/api");
    expect(JSON.parse(init.body)).toEqual({
      source: "Bangumi",
      path: "/characters/42",
    });
    expect(init.headers.Authorization).toBeUndefined();
    return new Response(JSON.stringify({ id: 42 }));
  });
  vi.stubGlobal("fetch", fetch);
  expect(
    await externalJSON("Bangumi", "https://api.bgm.tv/v0/characters/42"),
  ).toEqual({ id: 42 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(dispatchEvent).not.toHaveBeenCalled();
  expect(avatarFallbackURL("https://lain.bgm.tv/portrait.jpg")).toContain(
    "/__huiqi_character/image",
  );
  expect(avatarFallbackURL("https://unknown.example/portrait.jpg")).toBeNull();
});

it("纠正英文误登记别名为Tag无需确认，保留真实别名、其他预设和私人备注且可撤销", async () => {
  const character = newCharacter("测试角色");
  const original = "Character \\(series\\), (jitome:0.8), White Dress";
  character.aliases = ["真实别名", original];
  character.notes = "私人笔记";
  character.presets.push(newPreset("other tag", "其他预设"));
  character.presets[0].negative = "bad hands";
  character.presets[0].notes = "预设备注";
  await db.characters.put(character);
  const data: Data = {
    characters: [character],
    events: [],
    tasks: [],
    recommendations: [],
    settings: defaults,
  };
  const pending = prepareCharacterTags(
    {
      characterId: character.id,
      moveAliasesToTags: [original],
      summary: "纠正人物Tag",
    },
    data,
    "correct-tags",
  );
  expect(pending.reasons).toEqual([]);
  expect(await db.characters.get(character.id)).toEqual(character);
  const log = await applyPending(pending);
  const saved = await db.characters.get(character.id);
  expect(saved?.aliases).toEqual(["真实别名"]);
  expect(saved?.presets[0]).toEqual({
    ...character.presets[0],
    positive: original,
  });
  expect(saved?.presets[1]).toEqual(character.presets[1]);
  expect(saved?.defaultPresetId).toBe(character.defaultPresetId);
  expect(saved?.notes).toBe(character.notes);
  expect(await db.characters.count()).toBe(1);
  await repository.undo(log.id);
  expect((await db.characters.get(character.id))?.aliases).toEqual(
    character.aliases,
  );
  expect(() =>
    prepareCharacterTags(
      {
        characterId: character.id,
        moveAliasesToTags: ["伪造文字"],
        summary: "错误",
      },
      data,
      "bad",
    ),
  ).toThrow("不在当前别名");
  expect(() =>
    prepareCharacterTags(
      {
        characterId: character.id,
        presetId: "fake",
        positive: "x",
        summary: "错误",
      },
      data,
      "bad",
    ),
  ).toThrow("预设 ID");
});

it("上游流式错误丢弃半截工具，普通响应兼容重试一次并保留工具权限", async () => {
  let count = 0;
  const config = {
    endpoint: "https://test.example/v1",
    model: "test",
    key: "private-key",
    remember: false,
    mode: "tools" as const,
  };
  const fetch = vi.fn(async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body);
    if (++count === 1) {
      expect(body.stream).toBe(true);
      return new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"&#x20;","tool_calls":[{"index":0,"id":"bad","function":{"name":"apply_changes","arguments":"{"}}]}}]}\n\ndata: {"error":{"type":"server_error","message":"private-key hidden"}}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    expect(body.stream).toBeUndefined();
    expect(body.tools).toEqual([{ type: "function" }]);
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "完整回复" } }],
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const onText = vi.fn();
  expect(
    (await completion(config, [], [{ type: "function" }], undefined, onText))
      .content,
  ).toBe("完整回复");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(onText).toHaveBeenCalledWith("");
  expect(await db.logs.count()).toBe(0);
  const auth = new AIStreamError({
    code: "invalid_api_key",
    message: "private-key hidden",
  });
  expect(auth.message).toContain("鉴权失败");
  expect(auth.message).not.toContain("private-key");
  expect(auth.retryNonStreaming).toBe(false);
  expect(hasVisibleReply(" \n&#x20;&nbsp;\u200b")).toBe(false);
  expect(hasVisibleReply("已查到资料")).toBe(true);
});
