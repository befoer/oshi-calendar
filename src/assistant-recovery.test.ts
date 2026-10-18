import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  runAssistant,
  prepareBirthdayFindings,
  prepareWebBirthdays,
  applyPending,
  type AIConfig,
} from "./ai";
import { readCompletionStream } from "./ai-stream";
import {
  focusWebPage,
  loadAssistantCheckpoint,
  clearAssistantCheckpoint,
} from "./assistant-state";
import { db, repository, exportBackup } from "./store";
import { defaults, newCharacter, type Data } from "./domain";
const config: AIConfig = {
  endpoint: "https://test.example/v1",
  key: "private-secret",
  model: "test",
  remember: false,
  mode: "tools",
};
const source = "https://source.example/beatrice";
const quote =
  "ベアトリスの記念日 3月17日。物語的な都合で誕生日秘密のベア子ですが、スバルが連れ出してくれた日が再スタートの日！";
const page = {
  success: true as const,
  url: source,
  title: "作者のコメント",
  text: quote,
  truncated: false,
};
const call = (name: string, args: unknown, id = name) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const tools = (calls: unknown[]) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { role: "assistant", content: null, tool_calls: calls } },
      ],
    }),
  );
const reply = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: "已保存核实结论，生日仍为空" },
        },
      ],
    }),
  );
beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put(defaults);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("模型超时自动重试一次，保留网页与成功修改，续接不重新查询或重复新增", async () => {
  const character = newCharacter("碧翠丝");
  await db.characters.put(character);
  let rounds = 0,
    reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      if (String(url).startsWith("/__huiqi_web/read")) {
        reads++;
        return new Response(JSON.stringify(page));
      }
      rounds++;
      if (rounds === 1)
        return tools([
          call("apply_changes", {
            summary: "新增测试节日",
            changes: [
              {
                collection: "events",
                action: "put",
                data: {
                  title: "测试节日",
                  recurrence: "solar",
                  month: 11,
                  day: 11,
                },
              },
            ],
          }),
          call("read_web", { url: source }),
        ]);
      if (rounds <= 3) throw new DOMException("timed out", "TimeoutError");
      const body = JSON.parse(init.body);
      expect(body.messages.filter((m: any) => m.role === "tool")).toHaveLength(
        rounds === 4 ? 2 : 3,
      );
      if (rounds === 4) {
        expect(body.model).toBe("fallback-model");
        return tools([
          call("record_birthday_findings", {
            findings: [
              {
                characterId: character.id,
                status: "unpublished",
                sourceUrl: source,
                quote,
                summary: "作者称生日保密，3月17日为纪念日",
              },
            ],
          }),
        ]);
      }
      return reply();
    }),
  );
  await expect(
    runAssistant(
      config,
      [{ role: "user", content: "补齐生日并新增测试节日" }],
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("超时");
  expect(rounds).toBe(3);
  const saved = await loadAssistantCheckpoint();
  expect(saved?.pages).toHaveLength(1);
  expect(saved?.logIds).toHaveLength(1);
  expect(saved?.round).toBe(1);
  expect(JSON.stringify(saved)).not.toContain("private-secret");
  expect(JSON.stringify(await exportBackup())).not.toContain("assistantRuns");
  const result = await runAssistant(
    { ...config, model: "fallback-model" },
    [],
    new AbortController().signal,
    () => {},
    () => {},
    true,
  );
  expect(result.logs).toHaveLength(2);
  expect(reads).toBe(1);
  expect(await db.events.count()).toBe(1);
  expect(await db.logs.count()).toBe(2);
  expect((await db.characters.get(character.id))?.birthday).toBeNull();
  expect((await db.characters.get(character.id))?.birthdaySource).toContain(
    "生日未公开",
  );
  expect(await loadAssistantCheckpoint()).toBeUndefined();
});
it("一批工具中途取消，续接从下一个工具开始，不重复已提交的修改", async () => {
  let rounds = 0;
  const abort = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: any, init: any) => {
      if (++rounds === 1)
        return tools([
          call("apply_changes", {
            summary: "新增一次",
            changes: [
              {
                collection: "characters",
                action: "put",
                data: { name: "唯一角色" },
              },
            ],
          }),
          call("query_data", {}),
        ]);
      const messages = JSON.parse(init.body).messages;
      expect(messages.filter((m: any) => m.role === "tool")).toHaveLength(2);
      return reply();
    }),
  );
  await expect(
    runAssistant(config, [], abort.signal, () => abort.abort()),
  ).rejects.toThrow("取消");
  expect((await loadAssistantCheckpoint())?.cursor).toBe(1);
  await runAssistant(
    config,
    [],
    new AbortController().signal,
    () => {},
    () => {},
    true,
  );
  expect(await db.characters.count()).toBe(1);
  expect(await db.logs.count()).toBe(1);
});
it("未知生日和纪念日不能变成生日，核实结论追加来源且保留手动日期，支持撤销", async () => {
  const character = newCharacter("碧翠丝");
  character.birthdaySource = "用户原有资料";
  const data: Data = {
    characters: [character],
    events: [],
    tasks: [],
    recommendations: [],
    settings: defaults,
  };
  const pages = new Map([[source, page]]);
  const birthday = {
    birthdays: [
      {
        characterId: character.id,
        month: 3,
        day: 17,
        sourceUrl: source,
        quote,
      },
    ],
  };
  expect(() => prepareWebBirthdays(birthday, data, pages, "r")).toThrow(
    "未公开",
  );
  const anniversary = {
    ...page,
    text: "Birthday discussion: Beatrice anniversary March 17.",
  };
  expect(() =>
    prepareWebBirthdays(
      { birthdays: [{ ...birthday.birthdays[0], quote: anniversary.text }] },
      data,
      new Map([[source, anniversary]]),
      "r",
    ),
  ).toThrow("纪念日");
  character.birthday = { month: 4, day: 1 };
  character.birthdayConfidence = "confirmed";
  await db.characters.put(character);
  const pending = prepareBirthdayFindings(
    {
      findings: [
        {
          characterId: character.id,
          status: "unpublished",
          sourceUrl: source,
          quote,
          summary: "来源称生日保密",
        },
      ],
    },
    data,
    pages,
    "findings",
  );
  const log = await applyPending(pending);
  const updated = await db.characters.get(character.id);
  expect(updated?.birthday).toEqual({ month: 4, day: 1 });
  expect(updated?.birthdaySource).toContain("用户原有资料");
  expect(updated?.birthdaySource).toContain(quote);
  await repository.undo(log.id);
  expect((await db.characters.get(character.id))?.birthdaySource).toBe(
    "用户原有资料",
  );
  expect(() =>
    prepareBirthdayFindings(
      {
        findings: [
          {
            characterId: character.id,
            status: "unpublished",
            sourceUrl: source,
            quote: "编造的原文生日秘密",
            summary: "不合法",
          },
        ],
      },
      data,
      pages,
      "r",
    ),
  ).toThrow("原文");
});
it("长网页给模型的正文缩短且保留日期及未公开提示，本地原文保持不变", () => {
  const original = {
    ...page,
    text: "导航及介绍\n".repeat(1400) + quote + "\n其他内容".repeat(1400),
  };
  const compact = focusWebPage(original);
  expect(compact.text.length).toBeLessThanOrEqual(6000);
  expect(compact.text).toContain(quote);
  expect(original.text.length).toBeGreaterThan(6000);
});
it("流持续发送数据时可超过单个空闲期限；真正无数据才超时", async () => {
  vi.useFakeTimers();
  const encode = (data: unknown) =>
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const delay of [80, 160, 240])
          setTimeout(
            () =>
              controller.enqueue(
                encode({
                  choices: [
                    {
                      index: 0,
                      delta: { content: "文字" },
                      finish_reason: null,
                    },
                  ],
                }),
              ),
            delay,
          );
        setTimeout(() => {
          controller.enqueue(
            encode({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }),
          );
          controller.close();
        }, 300);
      },
    }),
  );
  const result = readCompletionStream(response, () => {}, undefined, 120);
  await vi.advanceTimersByTimeAsync(300);
  expect((await result).content).toBe("文字文字文字");
  const stalled = readCompletionStream(
    new Response(new ReadableStream({ start() {} })),
    () => {},
    undefined,
    120,
  );
  const rejection = expect(stalled).rejects.toThrow("长时间无数据");
  await vi.advanceTimersByTimeAsync(120);
  await rejection;
});
it("待确认提案刷新后可恢复，清除未完成操作不会删除角色", async () => {
  const character = newCharacter("测试角色");
  await db.characters.put(character);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      tools([
        call("apply_changes", {
          summary: "删除角色",
          changes: [
            { collection: "characters", action: "delete", id: character.id },
          ],
        }),
      ]),
    ),
  );
  const first = await runAssistant(
    config,
    [],
    new AbortController().signal,
    () => {},
  );
  expect((await loadAssistantCheckpoint())?.pending).toBeDefined();
  const restored = await runAssistant(
    config,
    [],
    new AbortController().signal,
    () => {},
    () => {},
    true,
  );
  expect(restored.pending?.requestId).toBe(first.pending?.requestId);
  expect(await db.characters.count()).toBe(1);
  await clearAssistantCheckpoint();
  expect(await db.characters.count()).toBe(1);
});
