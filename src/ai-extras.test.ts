import { afterEach, expect, it, vi } from "vitest";
import {
  aiConfigured,
  generateBirthdayMessages,
  generateBirthdayPack,
  parseNoteList,
  suggestCharacterTag,
  type AIConfig,
} from "./ai";

const config: AIConfig = {
  endpoint: "https://example.test/v1",
  key: "test-key",
  model: "test-model",
  remember: false,
  mode: "tools",
};
const reply = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
afterEach(() => vi.unstubAllGlobals());

it("接口地址、模型、密钥齐全才算已配置 AI", () => {
  expect(aiConfigured(config)).toBe(true);
  expect(aiConfigured({ ...config, key: " " })).toBe(false);
  expect(aiConfigured({ ...config, model: "" })).toBe(false);
});

it("留言解析：JSON 数组、带 messages 字段的对象、逐行文字都能拆成多条，去引号和重复", () => {
  expect(parseNoteList('["「甲。」","乙。","甲。"]')).toEqual(["甲。", "乙。"]);
  expect(parseNoteList('```json\n{"messages":["甲","乙"]}\n```')).toEqual([
    "甲",
    "乙",
  ]);
  expect(parseNoteList("1. 第一条\n2、第二条\n- 第三条\n\n")).toEqual([
    "第一条",
    "第二条",
    "第三条",
  ]);
  expect(parseNoteList("只有一条。")).toEqual(["只有一条。"]);
  expect(parseNoteList("  ")).toEqual([]);
});

it("留言解析不会把占位文本、非留言 JSON 或对象字段显示为角色留言", () => {
  expect(parseNoteList('{"messages":"placeholder"}')).toEqual([]);
  expect(parseNoteList('{"replies":["你好"]}')).toEqual([]);
  expect(parseNoteList("messages placeholder")).toEqual([]);
  expect(
    parseNoteList('{"messages":["placeholder","生日一起过吧。"]}'),
  ).toEqual(["生日一起过吧。"]);
});

it("生日留言：只发送角色名、作品名与已有留言，要求不写具体天数，并区分当天与提前", async () => {
  const request = vi.fn(async () =>
    reply('["今天也要一起出发哦。","生日快乐。"]'),
  );
  vi.stubGlobal("fetch", request);
  const list = await generateBirthdayMessages(
    config,
    { name: "灰之魔女（伊蕾娜）", works: ["魔女之旅"] },
    "today",
    2,
    ["之前写过的一条"],
  );
  expect(list).toEqual(["今天也要一起出发哦。", "生日快乐。"]);
  const body = JSON.parse(
    String(((request.mock.calls[0] as unknown[][])[1] as RequestInit).body),
  );
  expect(body.messages[0].content).toContain("不要出现具体的天数");
  expect(JSON.parse(body.messages[1].content)).toEqual({
    character: "灰之魔女（伊蕾娜）",
    works: ["魔女之旅"],
    situation: "今天是你的生日，你在向玩家问候",
    count: 2,
    avoid: ["之前写过的一条"],
  });
  await generateBirthdayMessages(
    config,
    { name: "露露卡", works: [] },
    "soon",
    5,
  );
  const later = JSON.parse(
    String(((request.mock.calls[1] as unknown[][])[1] as RequestInit).body),
  );
  const situation = JSON.parse(later.messages[1].content).situation;
  expect(situation).toContain("快到了");
  expect(situation).not.toMatch(/\d/);
});

it("生日留言：超出条数的截掉；AI 没有内容或接口失败时抛出可读错误", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply('["一","二","三"]')),
  );
  expect(
    await generateBirthdayMessages(
      config,
      { name: "角色", works: [] },
      "soon",
      2,
    ),
  ).toEqual(["一", "二"]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply("  ")),
  );
  await expect(
    generateBirthdayMessages(config, { name: "角色", works: [] }, "soon", 3),
  ).rejects.toThrow("AI 没有返回内容");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("no", { status: 401 })),
  );
  await expect(
    generateBirthdayMessages(config, { name: "角色", works: [] }, "soon", 3),
  ).rejects.toThrow("密钥无效");
});

it("推荐 Tag：解析 JSON（允许代码块），下划线转空格，缺省字段补空", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      reply(
        '```json\n{"tag":"nahida_\\\\(genshin_impact\\\\)","traits":"green_eyes, white_hair","note":"把握较高"}\n```',
      ),
    ),
  );
  const result = await suggestCharacterTag(config, {
    name: "纳西妲",
    works: ["原神"],
    aliases: [],
  });
  expect(result.tag).toBe("nahida \\(genshin impact\\)");
  expect(result.traits).toBe("green eyes, white hair");
  expect(result.note).toBe("把握较高");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply('{"tag":"x"}')),
  );
  expect(
    await suggestCharacterTag(config, { name: "角色", works: [], aliases: [] }),
  ).toEqual({ tag: "x", traits: "", note: "" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply("不是 JSON")),
  );
  await expect(
    suggestCharacterTag(config, { name: "角色", works: [], aliases: [] }),
  ).rejects.toThrow();
});

it("留言顺便生成聊天快捷回复：要求写进提示，解析 replies；没按要求给也不影响留言", async () => {
  const body = {
    messages: ["留言一。", "留言二。"],
    replies: ["今天过得怎么样？", "陪我聊会儿", "陪我聊会儿", ""],
  };
  const request = vi.fn(async () => reply(JSON.stringify(body)));
  vi.stubGlobal("fetch", request);
  const pack = await generateBirthdayPack(
    config,
    { name: "露露卡", works: [] },
    "soon",
    2,
    [],
    undefined,
    4,
  );
  expect(pack.messages).toEqual(["留言一。", "留言二。"]);
  expect(pack.replies).toEqual(["今天过得怎么样？", "陪我聊会儿"]);
  const sent = JSON.parse(
    String(((request.mock.calls[0] as unknown[][])[1] as RequestInit).body),
  );
  expect(sent.messages[0].content).toContain("玩家可能对该角色说的话");
  expect(JSON.parse(sent.messages[1].content).replyCount).toBe(4);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply('["只有留言。"]')),
  );
  const none = await generateBirthdayPack(
    config,
    { name: "露露卡", works: [] },
    "soon",
    1,
    [],
    undefined,
    4,
  );
  expect(none).toEqual({ messages: ["只有留言。"], replies: [] });
  // 不要快捷回复时，请求内容与以前完全一致
  const plain = vi.fn(async () => reply('["一。"]'));
  vi.stubGlobal("fetch", plain);
  await generateBirthdayMessages(
    config,
    { name: "角色", works: [] },
    "soon",
    1,
  );
  const plainSent = JSON.parse(
    String(((plain.mock.calls[0] as unknown[][])[1] as RequestInit).body),
  );
  expect(JSON.parse(plainSent.messages[1].content)).not.toHaveProperty(
    "replyCount",
  );
});
