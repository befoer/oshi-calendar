import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
// This check verifies offline data, independently of external service availability.
await page.route("https://api.bgm.tv/v0/**", (route) =>
  route.fulfill({
    json: {
      id: Number(route.request().url().split("/").at(-1)),
      name: "角色",
      infobox: [],
    },
  }),
);
await page.route("https://graphql.anilist.co/**", (route) =>
  route.fulfill({ json: { data: { Page: { characters: [] } } } }),
);
await page.goto("http://127.0.0.1:4173");
await page
  .getByRole("heading", { name: "把下一次创作，安排在好日子。" })
  .waitFor();
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
});
await page.reload();
await page
  .getByRole("heading", { name: "把下一次创作，安排在好日子。" })
  .waitFor();
await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
await page.waitForTimeout(2000);
const manifest = await page.evaluate(async () =>
  (await fetch("/manifest.webmanifest")).json(),
);
if (manifest.icons.length !== 2) throw new Error("Missing install icons");
await page.screenshot({
  path: "test-results/production-desktop.png",
  fullPage: true,
});
await page.locator("nav").getByRole("button", { name: "角色库" }).click();
await page.locator(".character-card").last().scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
const images = await page.locator(".character-cover img").evaluateAll((imgs) =>
  imgs.map((img) => ({
    alt: img.alt,
    loaded: img.complete && img.naturalWidth > 0,
  })),
);
await page.screenshot({
  path: "test-results/production-characters.png",
  fullPage: true,
});
await context.setOffline(true);
await page.reload();
await page.locator("nav").getByRole("button", { name: "角色库" }).click();
if ((await page.locator(".character-card").count()) !== 17)
  throw new Error("Offline data missing");
await page.getByRole("button", { name: "复制 洛琪希 的 Prompt" }).click();
if (
  !(await page.locator(".prompt-preview pre").innerText()).includes(
    "jitome:0.8",
  )
)
  throw new Error("Offline prompt missing");
await page.getByRole("button", { name: "关闭", exact: true }).click();
await page.screenshot({
  path: "test-results/production-offline.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "导航", exact: true }).click();
await page
  .locator("nav")
  .getByRole("button", { name: "日历", exact: true })
  .click();
await page.waitForTimeout(300);
if (
  await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
)
  throw new Error("Mobile calendar overflow");
await page.screenshot({
  path: "test-results/production-mobile-calendar.png",
  fullPage: true,
});
await page.getByRole("button", { name: "AI 助手", exact: true }).click();
await page.screenshot({
  path: "test-results/production-mobile-assistant.png",
  fullPage: true,
});
console.log(
  JSON.stringify(
    { offline: "passed", manifest: manifest.name, images, errors },
    null,
    2,
  ),
);
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
