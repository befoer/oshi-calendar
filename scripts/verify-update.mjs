import { chromium } from "@playwright/test";
import { writeFile, unlink, readFile } from "node:fs/promises";

const oldWorker = "dist/__verify_legacy_sw.js";
const harness = "dist/__verify_harness.html";
await writeFile(
  harness,
  "<!doctype html><html><body>Update harness</body></html>",
);
const legacyHTML = `<!doctype html><html><body><h1>17 位角色的生日待确认 · 旧缓存</h1><script>
if(new URL(location.href).searchParams.has('__huiqi_launch')) navigator.serviceWorker.register('/sw.js').then(r=>r.update());
</script></body></html>`;
await writeFile(
  oldWorker,
  `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(new Response(${JSON.stringify(legacyHTML)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));});`,
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext();
  let page = await context.newPage();
  await page.route("https://api.bgm.tv/**", (route) => route.abort());
  await page.route("https://graphql.anilist.co/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:4173");
  await page
    .getByRole("heading", { name: "把下一次创作，安排在好日子。" })
    .waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("huiqi-calendar");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("characters", "readwrite");
      const request = tx.objectStore("characters").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const c = cursor.value;
        c.birthday = null;
        c.birthdayConfidence = "unknown";
        c.birthdaySource = "";
        c.birthdayFetchedAt = "";
        if (c.id === "seed-16")
          c.presets[0].positive = "Kafu Chino, (custom:1.3)";
        cursor.update(c);
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    for (const registration of await navigator.serviceWorker.getRegistrations())
      await registration.unregister();
  });
  await page.close();
  page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/__verify_harness.html");
  await page.evaluate(() =>
    navigator.serviceWorker.register("/__verify_legacy_sw.js"),
  );
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.includes(
      "__verify_legacy_sw",
    ),
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "17 位角色的生日待确认 · 旧缓存" })
    .waitFor();
  const { buildId } = JSON.parse(await readFile("dist/build.json", "utf8"));
  await page.goto(
    `http://127.0.0.1:4173/?__huiqi_launch=${encodeURIComponent(buildId)}`,
  );
  await page
    .getByRole("heading", { name: "把下一次创作，安排在好日子。" })
    .waitFor({ timeout: 30000 });
  if (await page.getByRole("dialog", { name: "角色资料网络连接失败" }).count())
    await page.getByRole("button", { name: "稍后处理", exact: true }).click();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".cover-date")].filter((e) =>
        e.textContent.includes("生日待确认"),
      ).length === 3,
  );
  await page
    .locator(".character-card")
    .filter({ hasText: "香风智乃" })
    .getByRole("button", { name: "复制 香风智乃 的 Prompt" })
    .click();
  if (
    (await page.locator(".prompt-preview pre").innerText()) !==
    "Kafu Chino, (custom:1.3)"
  )
    throw new Error("Custom Tag changed during update");
  console.log(
    JSON.stringify({
      staleCacheUpgrade: "passed",
      verifiedBirthdays: 14,
      customTagPreserved: true,
    }),
  );
} finally {
  await browser.close();
  await unlink(oldWorker);
  await unlink(harness);
}
