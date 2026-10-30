// 打开录制专用的浏览器配置，让你在里面填写 AI 接口和密钥。关掉窗口即结束。
// 用法：node 宣传视频/制作/open-profile.mjs
import { chromium } from "@playwright/test";
import { PROFILE_DIR, APP_URL } from "./config.mjs";

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "msedge",
  headless: false,
  viewport: null,
  args: ["--start-maximized"],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(APP_URL);
await new Promise((resolve) => context.on("close", resolve));
