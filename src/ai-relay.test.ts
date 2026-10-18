import { afterEach, expect, it, vi } from "vitest";
import {
  completion,
  diagnoseAI,
  fetchModels,
  parseModelList,
  type AIConfig,
} from "./ai";
import { readCompletionStream } from "./ai-stream";

afterEach(() => vi.unstubAllGlobals());

const models = { data: [{ id: "gpt-b" }, { id: "gpt-a" }] };
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });
const relayError = (kind: "refused" | "network", error: string, status = 400) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "X-Huiqi-Relay-Error": kind },
  });

it("模型列表兼容不同中转站的写法", () => {
  expect(parseModelList({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] })).toEqual([
    "a",
    "b",
  ]);
  expect(parseModelList({ models: [{ name: "models/gemini-x" }, { model: "m2" }] })).toEqual([
    "gemini-x",
    "m2",
  ]);
  expect(parseModelList(["z", " y "])).toEqual(["y", "z"]);
  expect(parseModelList({ data: { models: [{ slug: "s1" }] } })).toEqual(["s1"]);
  expect(() => parseModelList({ data: [] })).toThrow("空模型列表");
  expect(() => parseModelList({ data: [{ id: 123 }] })).toThrow("格式无效");
  expect(() => parseModelList({ error: "x" })).toThrow("格式无效");
});

it("浏览器直连被跨域拦下时，改由本机服务转发；转发成功后同一主机直接走转发", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://nocors-a.example"))
        throw new TypeError("Failed to fetch");
      expect(url).toBe("/__huiqi_ai/relay");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        url: "https://nocors-a.example/v1/models",
        method: "GET",
        authorization: "Bearer k",
      });
      return json(models);
    }),
  );
  const config = { endpoint: "https://nocors-a.example/v1", key: "k" };
  expect(await fetchModels(config)).toEqual(["gpt-a", "gpt-b"]);
  expect(calls).toEqual([
    "https://nocors-a.example/v1/models",
    "/__huiqi_ai/relay",
  ]);
  calls.length = 0;
  expect(await fetchModels(config)).toEqual(["gpt-a", "gpt-b"]);
  expect(calls).toEqual(["/__huiqi_ai/relay"]);
});

it("转发被拒绝（本机或内网地址）时显示原来的网络错误；转发也连不上时带上原因", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/__huiqi_ai/relay"
        ? relayError("refused", "只转发公网地址的 AI 接口")
        : Promise.reject(new TypeError("Failed to fetch")),
    ),
  );
  await expect(
    fetchModels({ endpoint: "http://192.168.1.5:11434/v1", key: "k" }),
  ).rejects.toThrow(/^无法获取模型，请检查网络和接口地址/);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/__huiqi_ai/relay"
        ? relayError("network", "本机服务也无法连接该接口：连接超时", 502)
        : Promise.reject(new TypeError("Failed to fetch")),
    ),
  );
  await expect(
    fetchModels({ endpoint: "https://nocors-b.example/v1", key: "k" }),
  ).rejects.toThrow("无法获取模型：本机服务也无法连接该接口：连接超时");
});

it("没有本机服务（纯静态部署）时提示可能没有开启跨域，也不会请求转发", async () => {
  const request = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", request);
  await expect(
    fetchModels({ endpoint: "https://nocors-c.example/v1", key: "k" }),
  ).rejects.toThrow(/跨域（CORS）/);
  expect(request).toHaveBeenCalledTimes(1);
});

it("对话请求同样可以转发，并且流式标记会带给本机服务", async () => {
  vi.stubGlobal("location", { hostname: "127.0.0.1" });
  const config: AIConfig = {
    endpoint: "https://nocors-d.example/v1",
    model: "m",
    key: "k",
    remember: false,
    mode: "tools",
  };
  let relayBody: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/__huiqi_ai/relay")
        throw new TypeError("Failed to fetch");
      relayBody = JSON.parse(String(init?.body));
      return json({
        choices: [
          { finish_reason: "stop", message: { role: "assistant", content: "好" } },
        ],
      });
    }),
  );
  const message = await completion(config, [{ role: "user", content: "hi" }]);
  expect(message.content).toBe("好");
  expect(relayBody).toMatchObject({
    url: "https://nocors-d.example/v1/chat/completions",
    method: "POST",
    stream: false,
  });
  expect(JSON.parse(String(relayBody.body)).model).toBe("m");
});

const deepseek: AIConfig = {
  endpoint: "https://api.deepseek.com",
  model: "deepseek-chat",
  key: "sk-secretkey123456",
  remember: false,
  mode: "tools",
};

it("上游报错时把它的说明带出来：余额不足、参数被拒、遮住密钥、忽略 HTML 错误页", async () => {
  const reply = (status: number, body: string, type = "application/json") =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status, headers: { "Content-Type": type } })),
    );
  reply(402, JSON.stringify({ error: { message: "Insufficient Balance" } }));
  await expect(completion(deepseek, [])).rejects.toThrow("账户余额不足（402）");
  await expect(fetchModels(deepseek)).rejects.toThrow("账户余额不足（402）");
  reply(
    422,
    JSON.stringify({
      error: { message: "Failed to deserialize the JSON body (key sk-secretkey123456)" },
    }),
  );
  const rejected = await completion(deepseek, []).catch((e: Error) => e.message);
  expect(rejected).toContain("AI 请求失败 (422)：Failed to deserialize");
  expect(rejected).not.toContain("sk-secretkey123456");
  reply(503, JSON.stringify({ error: { message: "Server overloaded" } }));
  await expect(fetchModels(deepseek)).rejects.toThrow("获取模型失败 (503)：Server overloaded");
  reply(502, "<html><body>Bad gateway</body></html>", "text/html");
  const html = await completion(deepseek, []).catch((e: Error) => e.message);
  expect(html).toBe("AI 请求失败 (502)");
});

const sse = (text: string, split = 17) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(text);
        for (let i = 0; i < bytes.length; i += split)
          controller.enqueue(bytes.slice(i, i + split));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
const chunk = (delta: unknown, finish: string | null = null, extra = {}) =>
  `data: ${JSON.stringify({
    id: "c1",
    object: "chat.completion.chunk",
    model: "deepseek-chat",
    system_fingerprint: "fp",
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
    ...extra,
  })}

`;

it("DeepSeek 风格的流式响应：keep-alive 注释行、reasoning_content、末尾带 usage 的块都能正常解析", async () => {
  const seen: string[] = [];
  const message = await readCompletionStream(
    sse(
      ": keep-alive\n\n" +
        chunk({ role: "assistant", content: "" }) +
        chunk({ reasoning_content: "先想一想" }) +
        ": keep-alive\n\n" +
        chunk({ content: "你好" }) +
        chunk({ content: "，世界" }) +
        chunk({}, "stop", { usage: { prompt_tokens: 1, completion_tokens: 2 } }) +
        "data: [DONE]\n\n",
    ),
    (text) => seen.push(text),
  );
  expect(message).toEqual({ role: "assistant", content: "你好，世界" });
  expect(seen.at(-1)).toBe("你好，世界");
});

it("DeepSeek 风格的流式工具调用：首块带 id 与名称，后续只带参数片段", async () => {
  const message = await readCompletionStream(
    sse(
      chunk({
        role: "assistant",
        content: null,
        tool_calls: [
          { index: 0, id: "call_0_abc", type: "function", function: { name: "query_data", arguments: "" } },
        ],
      }) +
        chunk({ tool_calls: [{ index: 0, function: { arguments: "{" } }] }) +
        chunk({ tool_calls: [{ index: 0, function: { arguments: "}" } }] }) +
        chunk({}, "tool_calls") +
        "data: [DONE]\n\n",
    ),
    () => {},
  );
  expect(message.tool_calls).toEqual([
    { id: "call_0_abc", type: "function", function: { name: "query_data", arguments: "{}" } },
  ]);
});

it("连接诊断：直连被拦、转发可用、对话成功时逐步写清楚", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://diag-a.example")) throw new TypeError("Failed to fetch");
      const target = JSON.parse(String(init?.body)).url as string;
      return target.endsWith("/models")
        ? json({ data: [{ id: "m1" }, { id: "m2" }] })
        : json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "收到" } }] });
    }),
  );
  const steps = await diagnoseAI({
    ...deepseek,
    endpoint: "https://diag-a.example/v1",
  });
  expect(steps.map((s) => [s.label.split(" ")[0], s.ok])).toEqual([
    ["浏览器直连", false],
    ["本机服务转发", true],
    ["对话测试", true],
  ]);
  expect(steps[0].detail).toContain("没有开启跨域");
  expect(steps[1].detail).toBe("HTTP 200，2 个模型");
  expect(steps[2].detail).toBe("收到回复：收到");
  expect(JSON.stringify(steps)).not.toContain("sk-secretkey123456");
});

it("连接诊断：直连可用就不转发；对话报余额不足时写出原因；没有本机服务时提示", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/models")
        ? json({ data: [{ id: "m1" }] })
        : new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 }),
    ),
  );
  const ok = await diagnoseAI({ ...deepseek, endpoint: "https://diag-b.example" });
  expect(ok[0]).toMatchObject({ ok: true, detail: "HTTP 200，1 个模型" });
  expect(ok[1]).toMatchObject({ ok: true, detail: "直连已经可用，无需转发" });
  expect(ok[2].ok).toBe(false);
  expect(ok[2].detail).toContain("账户余额不足");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const blocked = await diagnoseAI({ ...deepseek, endpoint: "https://diag-c.example/v1" });
  expect(blocked[1].detail).toContain("纯静态部署");
  expect((await diagnoseAI({ ...deepseek, key: " " }))[0].detail).toContain("API Key");
  expect((await diagnoseAI({ ...deepseek, endpoint: "not a url" }))[0].label).toBe("接口地址");
  const noModel = await diagnoseAI({ ...deepseek, endpoint: "https://diag-b.example", model: "" });
  expect(noModel[2].detail).toContain("没有填写模型");
});
