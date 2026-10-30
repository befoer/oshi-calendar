// 检查录制专用浏览器里的 AI 配置是否就绪。只输出「是否有密钥」，不输出密钥内容。
import { chromium } from "@playwright/test";
import { PROFILE_DIR, APP_URL } from "./config.mjs";

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "msedge",
  headless: true,
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(APP_URL);
const info = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("huiqi-ai-config") || "{}");
  let host = "";
  try {
    host = new URL(raw.endpoint).host;
  } catch {}
  return {
    host,
    model: raw.model || "",
    remember: !!raw.remember,
    hasKey: typeof raw.key === "string" && raw.key.length > 0,
    persona: JSON.parse(localStorage.getItem("huiqi-chat-persona") || "{}").name || "",
  };
});
console.log(JSON.stringify(info));
await context.close();
