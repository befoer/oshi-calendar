import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readCompletionStream } from "./ai-stream";
import {
  completion,
  runAssistant,
  prepareWebBirthdays,
  applyPending,
  type AIConfig,
  type AssistantProgress,
} from "./ai";
import { db, repository } from "./store";
import { defaults, newCharacter, type Data } from "./domain";
const config: AIConfig = {
  endpoint: "https://ai.example.test/v1",
  model: "test",
  key: "private-key",
  remember: false,
  mode: "tools",
};
const wire = (data: unknown) =>
  `data: ${typeof data === "string" ? data : JSON.stringify(data)}\r\n\r\n`;
const delta = (data: unknown, finish: string | null = null) => ({
  choices: [{ index: 0, delta: data, finish_reason: finish }],
});
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(wire).join(""));
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 7));
        offset += 7;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
const message = (name: string, args: unknown, id = name) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
  );
const quote = "测试角色 Birthday: December 5. Gregorian calendar.";
const page = {
  success: true as const,
  url: "https://source.example/character",
  title: "角色档案",
  text: quote,
  truncated: false,
};
beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put(defaults);
});
afterEach(() => vi.unstubAllGlobals());

it("流式中文分片按顺序显示，CRLF、注释和DONE正确解析", async () => {
  const onText = vi.fn();
  const response = stream([
    delta({ content: "你好" }),
    delta({ content: "，绘期" }),
    delta({}, "stop"),
    "[DONE]",
  ]);
  const result = await readCompletionStream(response, onText);
  expect(onText.mock.calls.map(([t]) => t)).toEqual(["你好", "你好，绘期"]);
  expect(result.content).toBe("你好，绘期");
});
it("工具名称和JSON参数可跨分片，按索引组装后才执行", async () => {
  const result = await readCompletionStream(
    stream([
      delta({
        tool_calls: [
          {
            index: 1,
            id: "b",
            type: "function",
            function: { name: "query_data", arguments: "{}" },
          },
        ],
      }),
      delta({
        tool_calls: [
          {
            index: 0,
            id: "a",
            function: { name: "apply_", arguments: '{"summary":' },
          },
        ],
      }),
      delta({
        tool_calls: [
          {
            index: 0,
            function: { name: "changes", arguments: '"设置","changes":[]}' },
          },
        ],
      }),
      delta({}, "tool_calls"),
      "[DONE]",
    ]),
    () => {},
  );
  expect(result.tool_calls?.map((c) => c.id)).toEqual(["a", "b"]);
  expect(result.tool_calls?.[0].function.name).toBe("apply_changes");
  expect(JSON.parse(result.tool_calls![0].function.arguments).summary).toBe(
    "设置",
  );
});
it("请求带stream，未提供SSE的兼容接口仍能返回消息", async () => {
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "兼容回复" } }],
        }),
      ),
  );
  vi.stubGlobal("fetch", request);
  const onText = vi.fn();
  await completion(config, [], undefined, undefined, onText);
  expect(JSON.parse((request.mock.calls[0] as any)[1].body).stream).toBe(true);
  expect(onText).toHaveBeenCalledWith("兼容回复");
});
it("意外断流、长度截断和非法JSON不执行工具", async () => {
  const toolDelta = delta({
    tool_calls: [
      {
        index: 0,
        id: "edit",
        function: {
          name: "apply_changes",
          arguments: JSON.stringify({
            summary: "设置",
            changes: [
              {
                collection: "settings",
                action: "put",
                data: { reminderDays: 7 },
              },
            ],
          }),
        },
      },
    ],
  });
  for (const events of [
    [toolDelta],
    [toolDelta, delta({}, "length"), "[DONE]"],
    [toolDelta, "{bad JSON}"],
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => stream(events)),
    );
    await expect(
      runAssistant(config, [], new AbortController().signal, () => {}),
    ).rejects.toThrow();
    expect((await db.settings.get("main"))?.reminderDays).toBe(14);
    expect(await db.logs.count()).toBe(0);
  }
});
it("流式取消保存前停止，不执行已接收的工具参数", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      stream([
        delta({ content: "准备修改" }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: "edit",
              function: { name: "apply_changes", arguments: "{}" },
            },
          ],
        }),
        delta({}, "tool_calls"),
        "[DONE]",
      ]),
    ),
  );
  await expect(
    runAssistant(
      config,
      [],
      controller.signal,
      () => {},
      (p) => {
        if (p.type === "text" && p.text) controller.abort();
      },
    ),
  ).rejects.toThrow("取消");
  expect(await db.logs.count()).toBe(0);
});
it("网页生日必须引用本次正文，无效日期、重复角色和编造来源不会生成提案", () => {
  const character = newCharacter("测试角色");
  const data: Data = {
    characters: [character],
    events: [],
    tasks: [],
    recommendations: [],
    settings: defaults,
  };
  const birthdays = [
    {
      characterId: character.id,
      month: 12,
      day: 5,
      sourceUrl: page.url,
      quote,
    },
  ];
  expect(() =>
    prepareWebBirthdays({ birthdays }, data, new Map(), "r"),
  ).toThrow("本次");
  const pages = new Map([[page.url, page]]);
  expect(() =>
    prepareWebBirthdays(
      { birthdays: [{ ...birthdays[0], quote: "Birthday: December 6" }] },
      data,
      pages,
      "r",
    ),
  ).toThrow("原文");
  expect(() =>
    prepareWebBirthdays(
      { birthdays: [{ ...birthdays[0], month: 2, day: 30 }] },
      data,
      pages,
      "r",
    ),
  ).toThrow();
  expect(() =>
    prepareWebBirthdays(
      { birthdays: [{ ...birthdays[0], day: 6 }] },
      data,
      pages,
      "r",
    ),
  ).toThrow("原文不匹配");
  expect(() =>
    prepareWebBirthdays(
      { birthdays: [...birthdays, ...birthdays] },
      data,
      pages,
      "r",
    ),
  ).toThrow("多个");
});
it("多步网页搜索→读取→来源提案，确认后保存且能撤销", async () => {
  const character = newCharacter("测试角色");
  character.birthdaySource = "已有来源冲突";
  await db.characters.put(character);
  let round = 0;
  const request = vi.fn(async (url: any, init: any) => {
    if (String(url).startsWith("/__huiqi_web/")) {
      expect(init.headers.Authorization).toBeUndefined();
      expect(init.body).not.toContain("private-key");
      return new Response(
        JSON.stringify(
          String(url).endsWith("search")
            ? {
                success: true,
                provider: "Bing",
                query: "测试角色 生日",
                results: [
                  { title: page.title, url: page.url, snippet: "生日档案" },
                ],
              }
            : page,
        ),
      );
    }
    round++;
    if (round === 1) return message("search_web", { query: "测试角色 生日" });
    if (round === 2) return message("read_web", { url: page.url });
    const body = JSON.parse(init.body);
    expect(JSON.parse(body.messages.at(-1).content).success).toBe(true);
    return message("propose_web_birthdays", {
      birthdays: [
        {
          characterId: character.id,
          month: 12,
          day: 5,
          sourceUrl: page.url,
          quote,
        },
      ],
    });
  });
  vi.stubGlobal("fetch", request);
  const progress: AssistantProgress[] = [];
  const result = await runAssistant(
    config,
    [{ role: "user", content: "直接搜索网页补生日" }],
    new AbortController().signal,
    () => {},
    (p) => progress.push(p),
  );
  expect(
    progress.filter((p) => p.type === "tool" && p.status === "success"),
  ).toHaveLength(2);
  expect(result.pending?.reasons.join()).toContain("冲突");
  expect((await db.characters.get(character.id))?.birthday).toBeNull();
  const log = await applyPending(result.pending!);
  const updated = await db.characters.get(character.id);
  expect(updated?.birthday).toEqual({ month: 12, day: 5 });
  expect(updated?.birthdaySource).toContain(page.url);
  expect(updated?.birthdaySource).toContain(quote);
  await repository.undo(log.id);
  expect((await db.characters.get(character.id))?.birthday).toBeNull();
});
it("网页服务失败展示实际错误，并将失败返回模型", async () => {
  let round = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      if (String(url).startsWith("/__huiqi_web/"))
        return new Response(
          JSON.stringify({ success: false, error: "网页请求超时，请打开 VPN" }),
          { status: 502 },
        );
      if (++round === 1) return message("search_web", { query: "生日" });
      const result = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
      expect(result.success).toBe(false);
      expect(result.error).toContain("VPN");
      return stream([
        delta({ content: "搜索失败，没有写入修改" }),
        delta({}, "stop"),
        "[DONE]",
      ]);
    }),
  );
  const onProgress = vi.fn();
  await runAssistant(
    config,
    [],
    new AbortController().signal,
    () => {},
    onProgress,
  );
  expect(onProgress).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "tool",
      status: "error",
      detail: expect.stringContaining("VPN"),
    }),
  );
  expect(await db.logs.count()).toBe(0);
});
it("助手流式工具返回完整后可以自动修改主题和提醒设置", async () => {
  let round = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++round === 1
        ? stream([
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "settings",
                  function: {
                    name: "apply_changes",
                    arguments: JSON.stringify({
                      summary: "跟随系统并提前两周提醒",
                      changes: [
                        {
                          collection: "settings",
                          action: "put",
                          data: { theme: "system", reminderDays: 14 },
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            delta({}, "tool_calls"),
            "[DONE]",
          ])
        : stream([
            delta({ content: "已保存设置" }),
            delta({}, "stop"),
            "[DONE]",
          ]),
    ),
  );
  const result = await runAssistant(
    config,
    [],
    new AbortController().signal,
    () => {},
  );
  expect(result.logs).toHaveLength(1);
  expect((await db.settings.get("main"))?.theme).toBe("system");
});
