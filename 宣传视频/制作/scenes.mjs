// 录制 HTML 动画场景（开场、片头、功能速览引子、手机日历示意、片尾），同样慢放录制。
// 用法：node 宣传视频/制作/scenes.mjs [镜头id…]
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { Screencast } from "./lib/screencast.mjs";
import { SLOW } from "./lib/stage.mjs";
import { VIDEO_DIR, REC_DIR } from "./config.mjs";

const ROOT = join(VIDEO_DIR, "..");
const cfg = JSON.parse(await readFile(join(VIDEO_DIR, "制作/shots.json"), "utf8"));
const timing = JSON.parse(await readFile(join(VIDEO_DIR, "素材/tts/timing.json"), "utf8"));
const shots = cfg.segments.flatMap((s) => s.shots).filter((s) => s.kind === "html");
const wanted = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从导出的 .ics 里取露露卡生日事件的标题和提前提醒天数 */
async function icsEvent() {
  const file = join(VIDEO_DIR, "素材/export.ics");
  if (!existsSync(file)) return {};
  const text = (await readFile(file, "utf8")).replace(/\r?\n[ \t]/g, "");
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const summary = /SUMMARY:(.*)/.exec(block)?.[1]?.trim() ?? "";
    if (!summary.includes("露露卡")) continue;
    const days = /TRIGGER[^:]*:-P(\d+)D/.exec(block)?.[1];
    return { title: summary.replace(/\\,/g, "，"), days: days ? Number(days) : 14, file: "推日.ics" };
  }
  return {};
}

const types = { ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.route("http://scene.local/**", async (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = path.startsWith("/fonts/")
    ? join(ROOT, "public", path)
    : path === "/icon.svg"
      ? join(ROOT, "public/icon.svg")
      : path === "/styles/fonts.css"
        ? join(ROOT, "src/styles/fonts.css")
        : path.startsWith("/stills/") || path.startsWith("/hook/") || path.startsWith("/xhs/")
          ? join(VIDEO_DIR, "素材", path)
          : path.startsWith("/vfonts/")
            ? join(VIDEO_DIR, "素材/fonts", path.slice("/vfonts/".length))
          : join(VIDEO_DIR, "制作/scenes", path);
  if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
  await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? "application/octet-stream" });
});
const ev = await icsEvent();

// 小红书 3:4 配图（模板 scenes/xhs.html，素材截图在 素材/xhs/）
if (wanted.includes("xhs")) {
  for (let n = 1; n <= 6; n++) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1080, height: 1440 });
    await page.goto(`http://scene.local/xhs.html?page=${n}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    await sleep(600);
    const out = join(VIDEO_DIR, `成片/小红书/${n}.png`);
    await mkdir(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log("小红书：" + out);
    await page.close();
  }
}

// 封面：每套配色各出一张（配色定义在 scenes/cover.html）
const coverThemes = { lavender: "薰衣草粉", night: "夜空蓝紫", peach: "蜜桃暮色", mint: "天青紫" };
if (wanted.includes("cover")) {
  for (const [theme, label] of Object.entries(coverThemes)) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto(`http://scene.local/cover.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    await sleep(800);
    const out = join(VIDEO_DIR, `成片/封面-${label}.png`);
    await page.screenshot({ path: out });
    console.log("封面：" + out);
    await page.close();
  }
}

for (const shot of shots) {
  if (wanted.length && !wanted.includes(shot.id)) continue;
  const dur = (shot.lead ?? 0.15) + timing[shot.id].dur + (shot.pad ?? 0.25);
  const page = await context.newPage();
  const q = new URLSearchParams({ shot: shot.id, scene: shot.scene, dur: String(dur), ev: JSON.stringify(ev) });
  await page.goto(`http://scene.local/scene.html?${q}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await sleep(500);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
  const rec = new Screencast(page, join(REC_DIR, shot.id), { width: 1920, height: 1080, quality: 92 });
  await rec.start();
  await sleep(150);
  const start = Date.now() / 1000;
  await page.evaluate(() => window.go());
  await sleep(dur * 1000 * SLOW);
  // 静止画面不会产生新帧：结束前动一下页面，确保最后时刻有帧
  await page.evaluate(() => document.body.style.setProperty("outline", "1px solid transparent"));
  await sleep(200);
  const meta = await rec.stop();
  await writeFile(join(REC_DIR, shot.id, "meta.json"), JSON.stringify({ ...meta, start, slow: SLOW, zooms: [], cuts: [] }));
  console.log(`● ${shot.id} ${dur.toFixed(1)}s，${meta.frames.length} 帧`);
  await page.close();
}
await browser.close();
