import { afterEach, expect, it, vi } from "vitest";
import {
  buildImageRequest,
  resolveSize,
  withAffixes,
  extractImage,
  generateImage,
  imageConfigured,
  loadImageConfig,
  saveImageConfig,
  type ImageConfig,
} from "./image-gen";
import { pickImagePrompt } from "./chat-prompts";

afterEach(() => vi.unstubAllGlobals());

const base: ImageConfig = {
  kind: "images",
  endpoint: "https://img.example/v1/",
  model: "gpt-image-2",
  sizeMode: "none",
  size: "",
  syntax: "tags",
  prefix: "",
  suffix: "",
  key: "sk-test-key-123",
  remember: false,
  customUrl: "",
  customBody: '{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}"}',
  authStyle: "bearer",
};
const pngB64 = "iVBORw0KGgo" + "A".repeat(500);

it("生图密钥默认记住，兼容旧会话配置，重新打开后仍能读取", () => {
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
  local.set("huiqi-image-config", JSON.stringify({ ...base, key: "" }));
  session.set("huiqi-image-key", base.key);
  expect(loadImageConfig()).toMatchObject({ key: base.key, remember: true });
  saveImageConfig(base);
  session.clear();
  expect(loadImageConfig()).toMatchObject({ key: base.key, remember: true });
});

it("不同接口的返回里都能找到图：url、b64_json、data URI、Markdown、content 数组、纯 base64", () => {
  expect(extractImage({ data: [{ url: "https://x.test/a.png", size_bytes: 1 }] })).toBe(
    "https://x.test/a.png",
  );
  expect(extractImage({ data: [{ b64_json: pngB64 }] })).toBe(`data:image/png;base64,${pngB64}`);
  expect(extractImage({ images: [{ image_url: { url: "https://x.test/b.webp" } }] })).toBe(
    "https://x.test/b.webp",
  );
  expect(extractImage({ choices: [{ message: { content: "好的：![图](https://x.test/c.jpg) 完成" } }] })).toBe(
    "https://x.test/c.jpg",
  );
  expect(
    extractImage({ choices: [{ message: { content: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] } }] }),
  ).toBe("data:image/png;base64,QUJD");
  expect(extractImage({ output: ["https://x.test/d.png?sig=1"] })).toBe("https://x.test/d.png?sig=1");
  expect(extractImage({ result: { image: `/9j/${"A".repeat(500)}`.replace(/^/, "") } })).toMatch(
    /^data:image\/jpeg;base64,\/9j\//,
  );
  expect(extractImage({ id: "task-1", status: "pending" })).toBeNull();
  expect(extractImage("没有图的文字")).toBeNull();
});

it("三种接口类型的请求：OpenAI 图片接口、对话接口、自定义模板（转义提示词，可用 x-api-key）", () => {
  const images = buildImageRequest({ ...base, sizeMode: "custom", size: "1024x1024" }, "a \"cat\"");
  expect(images.url).toBe("https://img.example/v1/images/generations");
  expect(JSON.parse(images.body)).toEqual({
    model: "gpt-image-2",
    prompt: 'a "cat"',
    n: 1,
    size: "1024x1024",
  });
  expect(images.headers.Authorization).toBe("Bearer sk-test-key-123");
  expect(JSON.parse(buildImageRequest(base, "x").body)).not.toHaveProperty("size");
  const chat = buildImageRequest({ ...base, kind: "chat" }, "hi");
  expect(chat.url).toBe("https://img.example/v1/chat/completions");
  expect(JSON.parse(chat.body).messages[0]).toEqual({ role: "user", content: "hi" });
  const custom = buildImageRequest(
    { ...base, kind: "custom", customUrl: "https://c.example/api/draw", authStyle: "x-api-key", sizeMode: "custom", size: "1:1" },
    'line1\n"q"',
  );
  expect(custom.url).toBe("https://c.example/api/draw");
  expect(JSON.parse(custom.body)).toEqual({ model: "gpt-image-2", prompt: 'line1\n"q"', size: "1:1" });
  expect(custom.headers["x-api-key"]).toBe("sk-test-key-123");
  expect(custom.headers.Authorization).toBeUndefined();
  expect(() =>
    buildImageRequest({ ...base, kind: "custom", customUrl: "https://c", customBody: "{不是 json" }, "x"),
  ).toThrow("不是有效的 JSON");
});

it("配置判断：自定义只需要地址和模板，其余需要地址和模型；都要密钥", () => {
  expect(imageConfigured(base)).toBe(true);
  expect(imageConfigured({ ...base, key: "" })).toBe(false);
  expect(imageConfigured({ ...base, model: "" })).toBe(false);
  expect(imageConfigured({ ...base, kind: "custom", model: "", endpoint: "", customUrl: "https://c" })).toBe(true);
});

it("生图：直连成功就直接用；返回没有图或接口报错时给出能看懂的原因，不泄露密钥", async () => {
  const request = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).prompt).toBe("p");
    return new Response(JSON.stringify({ data: [{ url: "https://x.test/ok.png" }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", request);
  expect(await generateImage(base, "p")).toBe("https://x.test/ok.png");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "queued", key: "sk-test-key-123" }), { status: 200 })));
  const none = await generateImage(base, "p").catch((e: Error) => e.message);
  expect(none).toContain("没有找到图片");
  expect(none).not.toContain("sk-test-key-123");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "content policy" } }), { status: 400 })));
  await expect(generateImage(base, "p")).rejects.toThrow("生图失败 (400)：content policy");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 402 })));
  await expect(generateImage(base, "p")).rejects.toThrow("余额不足");
  await expect(generateImage({ ...base, key: "" }, "p")).rejects.toThrow("还没有配置生图接口");
});

it("生图接口没开跨域时，改由本机服务转发（自定义接口带 custom 标记）", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  let relayed: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/__huiqi_ai/relay") throw new TypeError("Failed to fetch");
      relayed = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ b64_json: pngB64 }] }), { status: 200 });
    }),
  );
  const image = await generateImage(
    { ...base, kind: "custom", customUrl: "https://relay-img.example/draw", authStyle: "x-api-key" },
    "p",
  );
  expect(image.startsWith("data:image/png;base64,")).toBe(true);
  expect(relayed).toMatchObject({ url: "https://relay-img.example/draw", method: "POST", apiKey: "sk-test-key-123", custom: true });
});

it("预置生图提示词：有 Tag 就用 Tag 和人物特征，没有就用角色名与作品，几种画面随机", () => {
  const withTag = pickImagePrompt({ name: "露露卡", works: ["光之美少女"], tag: "moria luluka", traits: "blonde hair" }, () => 0);
  expect(withTag.startsWith("moria luluka, blonde hair, ")).toBe(true);
  expect(withTag).toContain("masterpiece");
  expect(pickImagePrompt({ name: "露露卡", works: ["光之美少女"] }, () => 0)).toMatch(/^露露卡 \(光之美少女\), /);
  const scenes = new Set([0, 0.25, 0.5, 0.75, 0.99].map((r) => pickImagePrompt({ name: "甲", works: [] }, () => r)));
  expect(scenes.size).toBe(5);
});

it("默认尺寸是随机比例：3:4、4:3、1:1 各有机会；也可固定、自定义或不传", () => {
  const seen = new Set(
    [0, 0.4, 0.9].map((r) => resolveSize({ sizeMode: "random", size: "" }, () => r).ratio),
  );
  expect([...seen].sort()).toEqual(["1:1", "3:4", "4:3"]);
  expect(resolveSize({ sizeMode: "3:4", size: "" })).toEqual({ ratio: "3:4", size: "1024x1536" });
  expect(resolveSize({ sizeMode: "4:3", size: "" }).size).toBe("1536x1024");
  expect(resolveSize({ sizeMode: "1:1", size: "" }).size).toBe("1024x1024");
  expect(resolveSize({ sizeMode: "custom", size: " 640x480 " })).toEqual({ ratio: "", size: "640x480" });
  expect(resolveSize({ sizeMode: "none", size: "x" })).toEqual({ ratio: "", size: "" });
  const custom = buildImageRequest(
    { ...base, kind: "custom", customUrl: "https://c", customBody: '{"ar":"{{ratio}}","wh":"{{size}}"}' },
    "x",
    { ratio: "3:4", size: "1024x1536" },
  );
  expect(JSON.parse(custom.body)).toEqual({ ar: "3:4", wh: "1024x1536" });
});

it("提示词前后缀按语法拼接：标签用逗号，自然语言用空格", () => {
  expect(withAffixes({ syntax: "tags", prefix: "masterpiece", suffix: "8k" }, "a cat")).toBe("masterpiece, a cat, 8k");
  expect(withAffixes({ syntax: "natural", prefix: "", suffix: "Highly detailed." }, "A cat.")).toBe("A cat. Highly detailed.");
});
