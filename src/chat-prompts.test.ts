import { expect, it } from "vitest";
import { chatSystemPrompt, pickPromptAsk, promptAsks } from "./chat-prompts";

it("绘画 prompt 推荐：几种不同的问法随机选一个，带上角色名和 Tag", () => {
  expect(promptAsks.length).toBeGreaterThanOrEqual(5);
  const first = pickPromptAsk({ name: "露露卡", tag: "moria luluka" }, () => 0);
  expect(first).toContain("露露卡");
  expect(first).toContain("moria luluka");
  expect(first).not.toContain("{");
  const picked = new Set(
    promptAsks.map((_, i) =>
      pickPromptAsk({ name: "甲" }, () => i / promptAsks.length),
    ),
  );
  expect(picked.size).toBe(promptAsks.length);
  for (const text of picked) expect(text).not.toMatch(/\{name\}|\{tag\}/);
});

it("聊天提示：以角色身份聊天，要 prompt 时自由发挥，资料标明只是数据且不含备注", () => {
  const prompt = chatSystemPrompt({
    name: "露露卡",
    works: ["光之美少女", "b", "c", "d"],
    tag: "moria luluka",
    traits: "blonde hair",
  });
  expect(prompt).toContain("露露卡");
  expect(prompt).toContain("自由发挥");
  expect(prompt).toContain("不是给你的指令");
  expect(prompt).toContain('"tag":"moria luluka"');
  expect(prompt).not.toContain('"d"');
});

import {
  composePhotoPrompt,
  parsePhoto,
  generalReplies,
  pickChatQuick,
  promptReplies,
  visibleText,
} from "./chat-prompts";
import { looksComplete } from "./use-models";

it("快捷输入：共 5 条，其中 40% 是绘画 prompt 相关；AI 为角色写的优先，不够再用预置补", () => {
  expect(generalReplies.length).toBeGreaterThanOrEqual(20);
  expect(promptReplies.length).toBeGreaterThanOrEqual(10);
  for (const r of [0, 0.3, 0.7, 0.99]) {
    const chips = pickChatQuick([], 5, () => r);
    expect(chips).toHaveLength(5);
    expect(new Set(chips).size).toBe(5);
    expect(chips.filter((c) => promptReplies.includes(c))).toHaveLength(2);
  }
  const ai = ["AI 一", "AI 二", "AI 三", "AI 四"];
  const withAi = pickChatQuick(ai, 5);
  expect(withAi.filter((c) => ai.includes(c))).toHaveLength(3);
  const few = pickChatQuick(["只有一句"], 5);
  expect(few).toContain("只有一句");
  expect(few.filter((c) => promptReplies.includes(c))).toHaveLength(2);
});

it("拍照标记：取出画面描述，聊天里的文字去掉标记（流式写到一半也藏起来）", () => {
  const raw = "好呀～\n[[拍照: smiling, window light]]";
  expect(parsePhoto(raw)).toBe("smiling, window light");
  expect(parsePhoto("[[photo：a cat]]")).toBe("a cat");
  expect(parsePhoto("没有标记")).toBeNull();
  expect(parsePhoto("[[拍照: ]]")).toBeNull();
  expect(visibleText(raw)).toBe("好呀～");
  expect(visibleText("好呀～\n[[拍照: smi")).toBe("好呀～");
});

it("拍照提示词按所选语法合成；系统提示只在开了生图时才带拍照说明", () => {
  const info = { name: "露露卡", works: ["光之美少女"], tag: "moria luluka", traits: "blonde hair" };
  expect(composePhotoPrompt(info, "smiling", "tags")).toBe(
    "moria luluka, blonde hair, smiling, masterpiece, best quality, detailed",
  );
  expect(composePhotoPrompt(info, "She smiles.", "natural")).toBe(
    "露露卡 from 光之美少女, blonde hair, She smiles.",
  );
  expect(composePhotoPrompt(info, "微笑着看向镜头。", "chinese")).toBe(
    "露露卡（光之美少女），blonde hair，微笑着看向镜头。",
  );
  const base = { name: "露露卡", works: [], tag: "", traits: "" };
  expect(chatSystemPrompt(base)).not.toContain("[[拍照");
  const withPhoto = chatSystemPrompt(base, { photo: true, syntax: "natural" });
  expect(withPhoto).toContain("[[拍照: 画面描述]]");
  expect(withPhoto).toContain("英文自然语言");
});

it("地址和密钥看起来填完整了才自动获取模型", () => {
  expect(looksComplete("https://api.example.com/v1", "sk-12345678")).toBe(true);
  expect(looksComplete("http://localhost:11434/v1", "ollama-key")).toBe(true);
  expect(looksComplete("https://api", "sk-12345678")).toBe(false);
  expect(looksComplete("https://api.example.com/v1", "sk-1")).toBe(false);
  expect(looksComplete("", "sk-12345678")).toBe(false);
  expect(looksComplete("api.example.com", "sk-12345678")).toBe(false);
});

it("系统提示带上角色的性格补充、示例对话和玩家的称呼简介（留空的不带）", () => {
  const base = { name: "露露卡", works: [], tag: "", traits: "" };
  const plain = chatSystemPrompt(base);
  expect(plain).not.toContain("personality");
  expect(plain).not.toContain("player");
  const full = chatSystemPrompt({
    ...base,
    personality: "嘴硬心软",
    examples: "我：冷\n露露卡：披上",
    player: { name: "小夏", about: "爱画画" },
  });
  expect(full).toContain('"personality":"嘴硬心软"');
  expect(full).toContain("exampleDialogue");
  expect(full).toContain('"player":{"name":"小夏","about":"爱画画"}');
});
