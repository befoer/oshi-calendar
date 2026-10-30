import { test, expect, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=",
  "base64",
);
const character = {
  id: 72355,
  name: "イレイナ",
  birth_mon: 10,
  birth_day: 17,
  images: { medium: "https://lain.bgm.tv/r/400/pic/crt/l/elaina.jpg" },
  infobox: [
    { key: "简体中文名", value: "伊蕾娜" },
    { key: "生日", value: "10月17日" },
    { key: "别名", value: [{ k: "英文名", v: "Elaina" }] },
  ],
};
const aniImage =
  "https://s4.anilist.co/file/anilistcdn/character/large/elaina.jpg";
const anilist = {
  id: 127535,
  name: { full: "Elaina", native: "イレイナ", alternative: [] },
  image: { large: aniImage, medium: null },
  dateOfBirth: { year: null, month: 1, day: 1 },
  media: {
    nodes: [
      {
        title: {
          romaji: "Majo no Tabitabi",
          english: "Wandering Witch",
          native: "魔女の旅々",
        },
      },
    ],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Keep automatic background enrichment out of these user-triggered requests.
    Object.defineProperty(navigator, "onLine", { get: () => false });
    localStorage.setItem("huiqi-birthday-note-auto", "off");
  });
  await page.route("https://bangumi-api.acg-dna.top/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": route.request().headers().origin || "*",
    };
    return path === "/v1/image"
      ? route.fulfill({ contentType: "image/png", body: image, headers })
      : route.fulfill({
          json: path.includes("/search")
            ? { data: [character] }
            : path.endsWith("/subjects")
              ? [{ name_cn: "魔女之旅" }]
              : character,
          headers,
        });
  });
  await page.route("https://api.bgm.tv/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/search/")
        ? { data: [character] }
        : route.request().url().endsWith("/subjects")
          ? [{ name_cn: "魔女之旅" }]
          : character,
    }),
  );
  for (const pattern of [
    "https://lain.bgm.tv/**",
    "https://s4.anilist.co/**",
    "**/__huiqi_character/image?**",
  ])
    await page.route(pattern, (route) =>
      route.fulfill({ contentType: "image/png", body: image }),
    );
  await page.route("**/__huiqi_character/api", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Test: local service unavailable" },
    }),
  );
  await page.route("https://danbooru.donmai.us/**", (route) => route.abort());
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({ json: { data: { Page: { characters: [anilist] } } } }),
  );
});

async function openSearch(page: Page) {
  await page.goto("/");
  await page
    .locator("nav")
    .getByRole("button", { name: "角色库", exact: true })
    .click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByPlaceholder("输入角色名、Bangumi ID 或链接").fill("伊蕾娜");
}

test("网关搜索挂起时可立即改为直连，且刷新后记住选择", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "https://bangumi-api.acg-dna.top/v1/search?**",
    async (route) => {
      await gate;
      await route
        .fulfill({ json: { data: [{ ...character, name: "过期网关结果" }] } })
        .catch(() => {});
    },
  );
  const gatewayRequest = page.waitForRequest(
    "https://bangumi-api.acg-dna.top/v1/search?**",
  );
  await openSearch(page);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await gatewayRequest;
  const direct = page.waitForRequest("https://api.bgm.tv/v0/search/**");
  await page.getByRole("switch", { name: "直连 Bangumi", exact: true }).click();
  await direct;
  await expect(page.locator(".result-row")).toContainText("伊蕾娜");
  release();
  await expect(
    page.getByRole("switch", { name: "直连 Bangumi", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".result-row")).not.toContainText("过期网关结果");
  await page.reload();
  await page
    .locator("nav")
    .getByRole("button", { name: "角色库", exact: true })
    .click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "直连 Bangumi", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
});

test("只有展开角色才获取 AniList 头像，选择后保存头像而保留 Bangumi 生日与关联", async ({
  page,
}) => {
  const searches: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://graphql.anilist.co") &&
        typeof request.postDataJSON().variables.search === "string")
      searches.push(request.postDataJSON().variables.search);
  });
  await openSearch(page);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".result-row")).toBeVisible();
  expect(searches).toEqual([]);
  await page.locator(".result-row").click();
  const alternate = page.getByRole("button", {
    name: "使用备选头像 1",
    exact: true,
  });
  await expect(alternate).toBeVisible();
  expect(searches).toEqual(["イレイナ"]);
  await alternate.click();
  await expect(alternate).toHaveAttribute("aria-pressed", "true");
  await expect(alternate.locator("img")).toHaveAttribute("src", aniImage);
  await expect(
    page.getByRole("button", { name: "使用原头像", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".import-selection")).toContainText("10月17日");
  await page.getByRole("button", { name: "使用原头像", exact: true }).click();
  await expect(alternate).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "使用原头像", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await alternate.click();
  await page
    .getByRole("button", { name: "确认关联", exact: true })
    .last()
    .click();
  const saved = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("huiqi-calendar");
      request.onsuccess = () => resolve(request.result);
    });
    const records = await new Promise<any[]>((resolve) => {
      const request = database
        .transaction("characters")
        .objectStore("characters")
        .getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return records.find(
      (character) =>
        character.bangumiId === 72355 && character.name === "伊蕾娜",
    );
  });
  expect(saved.avatarUrl).toBe(aniImage);
  expect(saved.bangumiId).toBe(72355);
  expect(saved.anilistId ?? null).toBeNull();
  expect(saved.birthday).toMatchObject({ month: 10, day: 17 });
});

test("移除导入到选择器，头像加载中的标题和状态不重叠，多结果只显示首个头像", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://graphql.anilist.co/**", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        data: {
          Page: {
            characters: [
              anilist,
              {
                ...anilist,
                id: 127536,
                image: {
                  large: aniImage.replace("elaina", "second"),
                  medium: null,
                },
              },
            ],
          },
        },
      },
    });
  });
  await openSearch(page);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".result-row").click();
  await expect(page.getByText("导入到", { exact: true })).toHaveCount(0);
  const section = page.getByRole("region", { name: "更换头像", exact: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    const title = await section
      .getByText("更换头像", { exact: true })
      .boundingBox();
    const status = await section.getByRole("status").boundingBox();
    const information = await page.locator(".preview-info").boundingBox();
    expect(status!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
    const overlapsInfo =
      status!.x < information!.x + information!.width &&
      status!.x + status!.width > information!.x &&
      status!.y < information!.y + information!.height &&
      status!.y + status!.height > information!.y;
    expect(overlapsInfo).toBe(false);
    await page
      .getByRole("dialog")
      .screenshot({ path: `test-results/avatar-loading-${width}.png` });
  }
  release();
  await expect(section.getByRole("button")).toHaveCount(1);
  await expect(section.getByRole("button").locator("img")).toHaveAttribute(
    "src",
    aniImage,
  );
});

test("AniList 头像不可用时仍能预览和确认 Bangumi 资料", async ({ page }) => {
  await page.route("https://graphql.anilist.co/**", (route) => route.abort());
  await openSearch(page);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".result-row").click();
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用原头像", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "确认关联", exact: true }).last(),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "角色资料网络连接失败" }),
  ).toHaveCount(0);
});

for (const unavailable of [false, true]) {
  test(`AniList 头像${unavailable ? "获取失败" : "无搜索结果"}时提示和重试不与角色信息重叠`, async ({
    page,
  }) => {
    await page.route("https://graphql.anilist.co/**", (route) =>
      unavailable
        ? route.abort()
        : route.fulfill({ json: { data: { Page: { characters: [] } } } }),
    );
    await openSearch(page);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.locator(".result-row").click();
    const section = page.getByRole("region", { name: "更换头像", exact: true });
    const message = section.locator(".avatar-candidates-message");
    await expect(message).toContainText(
      unavailable ? "备选头像暂不可用" : "暂无备选头像",
    );
    for (const width of [1280, 768, 651, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await section.scrollIntoViewIfNeeded();
      const bounds = await section.boundingBox();
      const information = await page.locator(".preview-info").boundingBox();
      for (const element of [
        message,
        message.locator("span"),
        message.getByRole("button", { name: "重试" }),
      ]) {
        const box = (await element.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(box.x + box.width).toBeLessThanOrEqual(
          bounds!.x + bounds!.width + 1,
        );
        const overlapsInfo =
          box.x < information!.x + information!.width &&
          box.x + box.width > information!.x &&
          box.y < information!.y + information!.height &&
          box.y + box.height > information!.y;
        expect(overlapsInfo, `viewport ${width}`).toBe(false);
      }
      if (width === 1280 || width === 390)
        await page
          .getByRole("dialog")
          .screenshot({
            path: `test-results/avatar-${unavailable ? "error" : "empty"}-${width}.png`,
          });
    }
    await expect(
      page.getByRole("button", { name: "确认关联", exact: true }).last(),
    ).toBeEnabled();
  });
}

test("快速切换角色不会把先前角色的 AniList 头像显示到当前角色", async ({
  page,
}) => {
  const other = {
    ...character,
    id: 32,
    name: "ちぃ",
    infobox: [{ key: "简体中文名", value: "小叽" }],
  };
  await page.route("https://bangumi-api.acg-dna.top/v1/search?**", (route) =>
    route.fulfill({ json: { data: [character, other] } }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://graphql.anilist.co/**", async (route) => {
    const query = route.request().postDataJSON().variables.search;
    if (query === "イレイナ") await gate;
    const result =
      query === "ちぃ"
        ? {
            ...anilist,
            id: 32,
            image: {
              ...anilist.image,
              large: aniImage.replace("elaina", "chii"),
            },
            name: { full: "Chii", native: "ちぃ", alternative: [] },
          }
        : anilist;
    await route
      .fulfill({ json: { data: { Page: { characters: [result] } } } })
      .catch(() => {});
  });
  await openSearch(page);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const pending = page.waitForRequest("https://graphql.anilist.co/**");
  await page.locator(".result-row").filter({ hasText: "伊蕾娜" }).click();
  await pending;
  await page.locator(".result-row").filter({ hasText: "小叽" }).click();
  const alternate = page.getByRole("button", {
    name: "使用备选头像 1",
    exact: true,
  });
  await expect(alternate).toBeVisible();
  await expect(alternate.locator("img")).toHaveAttribute(
    "src",
    aniImage.replace("elaina", "chii"),
  );
  release();
  await expect(page.locator(".preview-head")).toContainText("小叽");
  await expect(alternate.locator("img")).toHaveAttribute(
    "src",
    aniImage.replace("elaina", "chii"),
  );
});

test("添加角色窗口加宽，来源使用双选滑块，单个直连开关位于底部且备选头像同行", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  const dialog = page.getByRole("dialog");
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(850);
  const source = page.getByRole("group", { name: "角色资料来源", exact: true });
  await expect(source.getByRole("button")).toHaveCount(2);
  await expect(
    source.getByRole("button", { name: "Bangumi", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator("select[aria-label='角色资料来源']")).toHaveCount(
    0,
  );
  await expect(
    dialog
      .locator("footer")
      .getByRole("switch", { name: "直连 Bangumi", exact: true }),
  ).toHaveCount(1);
  await expect(dialog.locator("footer a")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "使用网关", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".result-row").click();
  const candidates = page.getByRole("region", {
    name: "更换头像",
    exact: true,
  });
  await expect(
    candidates.getByRole("button", { name: "使用备选头像 1", exact: true }),
  ).toBeVisible();
  await expect(candidates.getByRole("button")).toHaveCount(1);
  await expect(candidates).not.toContainText("Elaina");
  await expect(candidates).not.toContainText("Bangumi");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await candidates.scrollIntoViewIfNeeded();
    const original = await page
      .getByRole("button", { name: "使用原头像", exact: true })
      .boundingBox();
    const alternate = await candidates
      .getByRole("button", { name: "使用备选头像 1", exact: true })
      .boundingBox();
    expect(Math.abs(original!.y - alternate!.y)).toBeLessThan(40);
    expect(alternate!.x).toBeGreaterThanOrEqual(original!.x + original!.width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("底部直连开关可关闭并恢复网关搜索", async ({ page }) => {
  await openSearch(page);
  const toggle = page.getByRole("switch", {
    name: "直连 Bangumi",
    exact: true,
  });
  const direct = page.waitForRequest("https://api.bgm.tv/v0/search/**");
  await toggle.click();
  await direct;
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const gateway = page.waitForRequest(
    "https://bangumi-api.acg-dna.top/v1/search?**",
  );
  await toggle.click();
  await gateway;
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".result-row")).toContainText("伊蕾娜");
});
