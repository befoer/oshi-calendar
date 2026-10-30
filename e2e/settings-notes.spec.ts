import { expect, test } from "@playwright/test";

test("首次配置后直接显示生日留言，密钥默认保存并位于模型之前", async ({
  page,
  context,
}) => {
  let finish!: () => void;
  const delayed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("https://notes.example/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204 });
    if (route.request().url().endsWith("/models"))
      return route.fulfill({ json: { data: [{ id: "test-model" }] } });
    await delayed;
    return route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                messages: ["今天也一起开心地度过吧。"],
                replies: ["生日快乐！"],
              }),
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".spot-note")).toContainText("设置");
  // 模拟旧版已缓存的占位文本；配置改变后不应取出展示。
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("huiqi-calendar");
      request.onsuccess = () => resolve(request.result);
    });
    const characters = await new Promise<{ id: string; name: string }[]>(
      (resolve) => {
        const request = database
          .transaction("characters")
          .objectStore("characters")
          .getAll();
        request.onsuccess = () => resolve(request.result);
      },
    );
    database.close();
    const items = [{ t: "messages placeholder", n: 0 }];
    localStorage.setItem(
      "huiqi-birthday-pool",
      JSON.stringify(
        Object.fromEntries(
          characters.map((c) => [
            c.id,
            { name: c.name, today: items, soon: items, at: Date.now() },
          ]),
        ),
      ),
    );
  });
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  const settings = page.locator("#set-ai");
  await settings
    .getByLabel("接口地址", { exact: true })
    .fill("https://notes.example/v1");
  await settings.getByLabel("API Key", { exact: true }).fill("mock-key");
  await settings.getByLabel("模型", { exact: true }).fill("test-model");
  expect(
    await settings
      .getByLabel("API Key", { exact: true })
      .evaluate((key) =>
        Boolean(
          key.compareDocumentPosition(
            document.querySelector('#set-ai [role="combobox"]')!,
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  await expect(page.getByText(/记住密钥/)).toHaveCount(0);
  await settings.getByRole("button", { name: "保存配置" }).click();
  await page.locator("nav").getByRole("button", { name: "创作工作台" }).click();
  await expect(page.locator(".spot-note")).toContainText("正在收到");
  finish();
  await expect(page.locator(".spot-note")).toContainText(
    "今天也一起开心地度过吧。",
  );
  await expect(page.locator(".spot-note")).not.toContainText("placeholder");
  await page.screenshot({
    path: "test-results/notes-after-config.png",
    fullPage: true,
  });
  // 新标签页没有原来的 sessionStorage，仍能取出密钥。
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.locator("nav").getByRole("button", { name: "设置" }).click();
  await expect(
    reopened.locator("#set-ai").getByLabel("API Key", { exact: true }),
  ).toHaveValue("mock-key");
  await reopened.close();
});
