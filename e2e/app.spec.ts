import { test, expect } from "@playwright/test";
import { defaults, newCharacter } from "../src/domain";
import { createServer } from "node:http";
import { today, dateKey, localDate } from "../src/calendar";
import { addDays } from "date-fns";

test("主题按钮在顶栏右侧，近期生日大头像、日历头像与生日标签适配明暗和手机", async ({
  page,
}) => {
  const avatar =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=";
  await page.goto("/");
  await page.evaluate(async (avatar) => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("huiqi-calendar");
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = database.transaction("characters", "readwrite");
      const request = tx.objectStore("characters").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, avatarUrl: avatar });
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
    });
    database.close();
  }, avatar);
  await page.reload();
  await expect(page.locator(".hero-actions .theme-toggle")).toHaveCount(0);
  await expect(page.locator(".top-actions .theme-toggle")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "我的角色", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".character-strip")).toHaveCount(0);
  const portrait = page.locator(".birthday-card .avatar.portrait").first();
  await expect(portrait.locator("img")).toBeVisible();
  expect((await portrait.boundingBox())!.height).toBeGreaterThan(120);
  const color = () =>
    page
      .locator(".hero-actions .primary")
      .evaluate((el) => getComputedStyle(el).color);
  expect(await color()).toBe("rgb(255, 255, 255)");
  await page.screenshot({
    path: "test-results/birthday-portraits-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "切换到夜间模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(color).toBe("rgb(21, 19, 48)");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(page.locator(".character-cover .cover-date")).toHaveCount(0);
  await expect(
    page.locator(".character-info .birthday-label").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/birthday-library-dark.png",
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await expect(
    page.locator(".calendar-event.birthday .avatar.calendar img").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/calendar-avatars-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "近期列表", exact: true }).click();
  await expect(
    page.locator(".calendar-list-title .avatar.calendar img").first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.locator(".top-actions .theme-toggle")).toBeVisible();
  await page.getByRole("button", { name: "切换到日间模式" }).click();
  await page.locator("nav").getByRole("button", { name: "创作工作台" }).click();
  await page.screenshot({
    path: "test-results/birthday-portraits-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("排除后由后续节日补齐五项；旧题材Tag不拼入角色Tag或任务", async ({
  page,
  context,
}) => {
  const start = today();
  const dates = [1, 2, 3, 4, 45, 75].map((n) =>
    dateKey(addDays(localDate(start), n)),
  );
  const character = newCharacter(
    "原文Tag测试",
    "Character \\(Series\\), (weight:0.8),  Dress",
  );
  const records = dates.map((date, i) => ({
    id: `refill-${i}`,
    title: `补齐节日${i + 1}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    recurrence: "once",
    date,
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8)),
    reminderDays: 14,
    tags: "unwanted_theme_keyword",
    notes: "",
  }));
  const recommendation = {
    id: "legacy-topic",
    title: "旧选题",
    dateStart: dates[0],
    dateEnd: dates[1],
    reason: "日期继续保留",
    characterIds: [character.id],
    source: "ai",
    tags: "unwanted_theme_keyword",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  await page.goto("/");
  await page.evaluate(
    async ({ records, character, recommendation }) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("huiqi-calendar");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve) => {
        const tx = database.transaction(
          ["events", "characters", "recommendations"],
          "readwrite",
        );
        records.forEach((e) => tx.objectStore("events").put(e));
        tx.objectStore("characters").put(character);
        tx.objectStore("recommendations").put(recommendation);
        tx.oncomplete = () => resolve();
      });
      database.close();
    },
    { records, character, recommendation },
  );
  await page.reload();
  await page.getByLabel("节日类型筛选").selectOption("custom");
  await expect(page.locator(".holiday-row")).toHaveCount(5);
  await expect(page.locator(".holiday-list")).toContainText("补齐节日5");
  await expect(page.locator(".holiday-list")).not.toContainText("补齐节日6");
  await page
    .getByRole("button", { name: "排除补齐节日1", exact: true })
    .click();
  await expect(page.locator(".holiday-row")).toHaveCount(5);
  await expect(page.locator(".holiday-list")).toContainText("补齐节日6");
  await expect(page.locator(".holiday-list")).not.toContainText("补齐节日1");
  await page.reload();
  await page.getByLabel("节日类型筛选").selectOption("custom");
  await expect(page.locator(".holiday-row")).toHaveCount(5);
  await page.getByRole("button", { name: /补齐节日2 自定义/ }).click();
  await expect(page.getByLabel("节日 Tag", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator("nav").getByRole("button", { name: "年度选题" }).click();
  const idea = page.locator(".idea-card").filter({ hasText: "旧选题" });
  await idea.getByRole("button", { name: "编辑选题" }).click();
  await expect(page.getByLabel("题材 Tag", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await idea.getByRole("button", { name: "复制 Tag" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "已复制「原文Tag测试」的 Tag",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    character.presets[0].positive,
  );
  await idea.getByRole("button", { name: "保存为创作任务" }).click();
  await expect(page.getByRole("textbox", { name: "Tag", exact: true })).toHaveValue(
    character.presets[0].positive,
  );
});
test.beforeEach(async ({ page }) => {
  // Gateway-specific behavior has its own tests; existing fixtures model direct APIs.
  await page.route("https://bangumi-api.acg-dna.top/**", (route) => route.abort());
  // 首页寿星卡的自动留言会多发一次 AI 请求；默认关闭，免得占用各用例脚本化的 AI 回合
  await page.addInitScript(() => {
    if (localStorage.getItem("huiqi-birthday-note-auto") === null)
      localStorage.setItem("huiqi-birthday-note-auto", "off");
  });
  await page.route("**/__huiqi_character/api", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "测试环境本地资料服务不可用" },
    }),
  );
  // 本机资料服务失败后，Tag 查询会让浏览器直连 Danbooru；测试里不碰真实网络。
  // AniList 与头像图片同理：真实网络慢的时候，超时会弹出「角色资料网络连接失败」把页面挡住，
  // 让耗时较长的用例随机失败。需要特殊行为的用例在自己里面重新注册路由即可覆盖这里。
  await page.route("https://danbooru.donmai.us/**", (route) => route.abort());
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({
      json: { data: { Page: { characters: [] }, Character: null } },
    }),
  );
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=",
    "base64",
  );
  for (const pattern of [
    "https://lain.bgm.tv/**",
    "https://s4.anilist.co/**",
    "**/__huiqi_character/image?**",
  ])
    await page.route(pattern, (route) =>
      route.fulfill({ contentType: "image/png", body: pixel }),
    );
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
});

test("助手收起后继续执行，入口转圈，思考强度发送并保存，完成后能撤销", async ({
  page,
}) => {
  // 这条用例要刷新页面、切换视口、截图，单独跑也要近 30 秒，并发时容易碰到默认的 45 秒上限
  test.setTimeout(120000);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bodies: any[] = [];
  await page.route(
    "https://background-ai.example/v1/chat/completions",
    async (route) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        await gate;
        await route.fulfill({
          json: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "background-setting",
                      type: "function",
                      function: {
                        name: "apply_changes",
                        arguments: JSON.stringify({
                          summary: "后台设置提前7天提醒",
                          changes: [
                            {
                              collection: "settings",
                              action: "put",
                              data: { reminderDays: 7 },
                            },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        });
      } else
        await route.fulfill({
          json: {
            choices: [
              {
                message: { role: "assistant", content: "后台修改完成，可撤销" },
              },
            ],
          },
        });
    },
  );
  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "huiqi-ai-config",
        JSON.stringify({
          endpoint: "https://background-ai.example/v1",
          model: "test",
          mode: "tools",
          remember: false,
        }),
      );
      sessionStorage.setItem("huiqi-ai-key", "mock-key");
    });
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page.getByLabel("思考强度").selectOption("high");
    await page.getByLabel("发送给 AI 助手").fill("将提醒改为7天");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(1);
    await page.getByRole("button", { name: "关闭助手", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "AI 创作助手" }),
    ).toBeHidden();
    const indicator = page.locator(".top-actions").getByLabel("AI 正在运行");
    await expect(indicator).toBeVisible();
    expect(
      await indicator.evaluate((el) => getComputedStyle(el).animationDuration),
    ).toBe("2s");
    expect(bodies[0].reasoning_effort).toBe("high");
    release();
    await expect(indicator).toHaveCount(0);
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(
      page.getByText("后台修改完成，可撤销", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".operation-result")).toContainText(
      "后台设置提前7天提醒",
    );
    await page
      .getByRole("button", { name: "撤销本次操作", exact: true })
      .click();
    await expect(page.locator(".operation-result")).toContainText("已撤销");
    await page.reload();
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(page.getByLabel("思考强度")).toHaveValue("high");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/assistant-reasoning-mobile.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    release();
  }
});

test("节日筛选、排除和恢复，排除不进入今日安排且刷新保留", async ({ page }) => {
  const date = today();
  const event = {
    id: "excluded-test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    title: "排除测试节日",
    recurrence: "solar",
    date,
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8)),
    reminderDays: 14,
    tags: "festive",
    notes: "",
  };
  await page.goto("/");
  await page.evaluate(async (e) => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("huiqi-calendar");
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = database.transaction("events", "readwrite");
      tx.objectStore("events").put(e);
      tx.oncomplete = () => resolve();
    });
    database.close();
  }, event);
  await page.reload();
  await expect(page.getByLabel("显示排除")).not.toBeChecked();
  await page.getByLabel("节日类型筛选").selectOption("custom");
  const row = page.locator(".holiday-row").filter({ hasText: event.title });
  await expect(row).toBeVisible();
  await expect(page.locator(".today-line")).toContainText(event.title);
  await row
    .getByRole("button", { name: "排除" + event.title, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(page.locator(".today-line").getByRole("button", { name: event.title, exact: true })).toHaveCount(0);
  await page.getByLabel("显示排除").check();
  await expect(row).toHaveClass(/excluded/);
  await expect(page.locator(".today-line").getByRole("button", { name: event.title, exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/holiday-exclusions-desktop.png",
  });
  await page.reload();
  await expect(page.getByLabel("显示排除")).not.toBeChecked();
  await expect(row).toHaveCount(0);
  await page.getByLabel("显示排除").check();
  await row
    .getByRole("button", { name: "恢复" + event.title, exact: true })
    .click();
  await expect(row).not.toHaveClass(/excluded/);
  await expect(page.locator(".today-line")).toContainText(event.title);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/holiday-filters-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("无生日可设置并刷新保留，不列入待确认，可恢复日期编辑；AniList 不带备用文字", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  const card = page.locator(".character-card").filter({ hasText: "洛琪希" });
  await card.locator(".character-cover").click();
  await page.getByLabel("无生日", { exact: true }).check();
  await expect(page.getByLabel("生日月")).toBeDisabled();
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(card.locator(".cover-date")).toHaveText("无生日");
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(card.locator(".cover-date")).toHaveText("无生日");
  await page.getByLabel("生日待确认", { exact: true }).check();
  await expect(card).toHaveCount(0);
  await page.getByLabel("生日待确认", { exact: true }).uncheck();
  await card.locator(".character-cover").click();
  await page.getByLabel("无生日", { exact: true }).uncheck();
  await expect(page.getByLabel("生日月")).toBeEnabled();
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(card.locator(".cover-date")).toHaveText("生日待确认");
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "角色资料来源", exact: true }).getByRole("button", { name: "AniList", exact: true }),
  ).toHaveText("AniList");
});

test("新建名字角色自动搜索确认，浏览器受限时通过本地资料服务获取生日和头像", async ({
  page,
}) => {
  let localReads = 0;
  const candidate = {
    id: 4242,
    name: "新增测试角色",
    images: { medium: "https://lain.bgm.tv/pic/crt/l/test.jpg" },
    birth_mon: 7,
    birth_day: 11,
    infobox: [{ key: "生日", value: "7月11日" }],
    works: ["测试作品"],
  };
  await page.route("https://api.bgm.tv/v0/**", (route) => route.abort());
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({ json: { data: { Page: { characters: [] } } } }),
  );
  await page.route("https://lain.bgm.tv/**", (route) => route.abort());
  await page.route("**/__huiqi_character/image?**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/__huiqi_character/api", (route) => {
    localReads++;
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: body.path?.startsWith("/search/")
        ? { data: [candidate] }
        : body.path?.endsWith("/subjects")
          ? [{ name_cn: "测试作品" }]
          : { ...candidate, id: Number(body.path?.split("/").at(-1)) },
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByRole("button", { name: "手动添加角色", exact: true }).click();
  await page.getByLabel("角色名称").fill(candidate.name);
  const original = "New Character \\(Series\\), (weight:1.2)";
  await page.getByLabel("Tag", { exact: true }).fill(original);
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute(
    "aria-label",
    "从 Bangumi 导入角色",
  );
  await page.locator(".bangumi-results .result-row").first().click();
  await page.locator(".import-selection").getByRole("button", { name: "确认关联" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已关联");
  const card = page
    .locator(".character-card")
    .filter({ hasText: candidate.name });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".cover-date")).toHaveText("7 / 11");
  await expect
    .poll(() =>
      card
        .locator("img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  expect(localReads).toBeGreaterThan(0);
  await expect(
    page.getByRole("dialog", { name: "角色资料网络连接失败" }),
  ).toHaveCount(0);
  // 已有的手动 Tag 保留原文，没有被资料覆盖
  await card.locator(".character-cover").click();
  await expect(
    page.getByRole("textbox", { name: "Tag", exact: true }),
  ).toHaveValue(original);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(card.locator(".cover-date")).toHaveText("7 / 11");
});

test("设置立即获取自动关联唯一候选，未关联角色默认折叠，保留手动生日", async ({
  page,
}) => {
  const character = newCharacter("未关联测试角色");
  character.birthday = { month: 4, day: 1 };
  character.birthdayConfidence = "confirmed";
  character.birthdaySource = "用户手动来源";
  await page.route("https://api.bgm.tv/v0/search/**", (route) =>
    route.fulfill({ json: { data: [{ id: 4242, name: character.name }] } }),
  );
  await page.route("https://api.bgm.tv/v0/characters/4242", (route) =>
    route.fulfill({
      json: {
        id: 4242,
        name: character.name,
        images: { medium: "https://lain.bgm.tv/test.jpg" },
        birth_mon: 7,
        birth_day: 11,
      },
    }),
  );
  await page.route("https://api.bgm.tv/v0/characters/4242/subjects", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/");
  await page.evaluate(async (c) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("huiqi-calendar");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("characters", "readwrite");
      tx.objectStore("characters").put(c);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  }, character);
  await page
    .locator("nav")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  const unlinked = page.locator(".unlinked-characters");
  await expect(unlinked.locator("summary")).toHaveText("未关联角色（1）");
  await expect(unlinked).not.toHaveAttribute("open", "");
  await expect(
    page.getByRole("button", { name: "选择资料 · " + character.name }),
  ).not.toBeVisible();
  await unlinked.locator("summary").click();
  await expect(
    page.getByRole("button", { name: "选择资料 · " + character.name }),
  ).toBeVisible();
  await unlinked.locator("summary").click();
  await page.getByRole("button", { name: "立即获取", exact: true }).click();
  await expect(unlinked.locator("summary")).toHaveText("未关联角色（0）");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(/获取完成：1 位角色已自动关联/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择资料 · " + character.name }),
  ).toHaveCount(0);
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page
    .locator(".character-card")
    .filter({ hasText: character.name })
    .locator(".character-cover")
    .click();
  await expect(page.getByLabel("生日月")).toHaveValue("4");
  await expect(page.getByLabel("生日日")).toHaveValue("1");
  await expect(page.getByLabel("头像 URL")).toHaveValue(
    "https://lain.bgm.tv/test.jpg",
  );
  await expect(page.getByRole("dialog")).toContainText("用户手动来源");
});

test("设置中重名候选保留在折叠列表，可展开手动选择，手机布局无溢出", async ({
  page,
}) => {
  const c = newCharacter("重名角色");
  await page.route("https://api.bgm.tv/v0/search/**", (route) =>
    route.fulfill({
      json: {
        data: [
          { id: 4242, name: c.name },
          { id: 4243, name: c.name },
        ],
      },
    }),
  );
  await page.route(
    /https:\/\/api\.bgm\.tv\/v0\/characters\/424[23](?:\/subjects)?$/,
    (route) =>
      route.fulfill({
        json: route.request().url().endsWith("subjects")
          ? []
          : {
              id: Number(route.request().url().split("/").at(-1)),
              name: c.name,
            },
      }),
  );
  await page.goto("/");
  await page.evaluate(async (character) => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("huiqi-calendar");
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = database.transaction("characters", "readwrite");
      tx.objectStore("characters").put(character);
      tx.oncomplete = () => resolve();
    });
    database.close();
  }, c);
  await page
    .locator("nav")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("button", { name: "立即获取", exact: true }).click();
  const group = page.locator(".unlinked-characters");
  await expect(group.locator("summary")).toHaveText("未关联角色（1）");
  await expect(
    page.getByText("找到 2 个候选，身份匹配不明确，请选择"),
  ).not.toBeVisible();
  await group.locator("summary").click();
  await expect(
    page.getByText("找到 2 个候选，身份匹配不明确，请选择"),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await group.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/unlinked-settings-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "选择资料 · " + c.name }).click();
  await expect(page.locator(".bangumi-results button")).toHaveCount(2);
});

test("流式错误后普通响应续接，AI直接纠正已有角色Tag并保留其他预设，可撤销", async ({
  page,
}) => {
  const character = newCharacter("纠正测试角色");
  const original = "Test Character \\(series\\), (jitome:0.8), White Dress";
  character.aliases = ["真正别名", original];
  character.presets.push({
    ...character.presets[0],
    id: "other-preset",
    name: "冬装",
    positive: "winter coat",
  });
  let calls = 0;
  await page.route("https://ai.example.test/v1/chat/completions", (route) => {
    const body = route.request().postDataJSON();
    const round = ++calls;
    if (round === 1)
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"index":0,"delta":{"content":"&#x20;"}}]}\n\ndata: {"error":{"type":"server_error"}}\n\n',
      });
    if (round === 2) expect(body.stream).toBeUndefined();
    if (round === 4)
      return route.fulfill({
        json: {
          choices: [
            {
              message: { role: "assistant", content: "已保存人物Tag，可撤销" },
            },
          ],
        },
      });
    return route.fulfill({
      json: {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-" + round,
                  type: "function",
                  function: {
                    name: round === 2 ? "query_data" : "update_character_tags",
                    arguments: JSON.stringify(
                      round === 2
                        ? {}
                        : {
                            characterId: character.id,
                            moveAliasesToTags: [original],
                            summary: "纠正人物Tag",
                          },
                    ),
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.evaluate(async (c) => {
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({
        endpoint: "https://ai.example.test/v1",
        model: "test",
        models: ["test"],
        key: "test-key",
        remember: true,
        mode: "tools",
      }),
    );
    const database = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("huiqi-calendar");
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = database.transaction("characters", "readwrite");
      tx.objectStore("characters").put(c);
      tx.oncomplete = () => resolve();
    });
    database.close();
  }, character);
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page
    .getByPlaceholder("添加角色、节日或安排创作…")
    .fill("登记错了，纠正测试角色的英文不是别名，是人物tag，修改");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".operation-result")).toContainText("纠正人物Tag");
  await expect(page.locator(".change-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认应用" })).toHaveCount(0);
  await expect(page.locator(".chat-message.assistant")).not.toContainText(
    "回复中断",
  );
  await expect(
    page.getByRole("button", { name: "撤销本次操作" }),
  ).toBeEnabled();
  expect(calls).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/tag-correction-mobile.png",
    fullPage: true,
  });
  const read = () =>
    page.evaluate(async (id) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open("huiqi-calendar");
        req.onsuccess = () => resolve(req.result);
      });
      const result = await new Promise<any>((resolve) => {
        const req = database
          .transaction("characters")
          .objectStore("characters")
          .get(id);
        req.onsuccess = () => resolve(req.result);
      });
      database.close();
      return result;
    }, character.id);
  const saved = await read();
  expect(saved.aliases).toEqual(["真正别名"]);
  expect(saved.presets[0].positive).toBe(original);
  expect(saved.presets[1].positive).toBe("winter coat");
  await page.getByRole("button", { name: "撤销本次操作" }).click();
  expect((await read()).aliases).toEqual(character.aliases);
});

test("网页资料和设置进度刷新后可续接，记录未公开生日并避免重复查询", async ({
  page,
}) => {
  const source = "https://evidence.example/beatrice";
  const quote =
    "ベアトリスの記念日。物語的な都合で誕生日秘密のベア子ですが、スバルが連れ出してくれた日が再スタートの日！";
  let rounds = 0,
    reads = 0,
    stalled = false;
  let release = () => {};
  await page.route("**/__huiqi_web/read", (route) => {
    reads++;
    return route.fulfill({
      json: {
        success: true,
        title: "作者のコメント",
        url: source,
        text: quote,
        truncated: false,
      },
    });
  });
  await page.route("https://recovery-ai.example/**", async (route) => {
    const body = route.request().postDataJSON();
    const state = JSON.parse(body.messages[0].content.split("资料：")[1]);
    const character = state.characters.find((c: any) => c.name === "碧翠丝");
    const call = (name: string, args: unknown) => ({
      id: name,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
    rounds++;
    if (rounds === 2) {
      stalled = true;
      await new Promise<void>((done) => {
        release = done;
      });
      await route
        .fulfill({
          json: {
            choices: [
              { message: { role: "assistant", content: "本次响应已取消" } },
            ],
          },
        })
        .catch(() => {});
      return;
    }
    const message =
      rounds === 1
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              call("read_web", { url: source }),
              call("apply_changes", {
                summary: "提前7天提醒",
                changes: [
                  {
                    collection: "settings",
                    action: "put",
                    data: { reminderDays: 7 },
                  },
                ],
              }),
            ],
          }
        : rounds === 3
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                call("record_birthday_findings", {
                  findings: [
                    {
                      characterId: character.id,
                      status: "unpublished",
                      sourceUrl: source,
                      quote,
                      summary: "生日保密，纪念日不是生日",
                    },
                  ],
                }),
              ],
            }
          : {
              role: "assistant",
              content: "已保存核实结论，碧翠丝生日未公开，未填写猜测日期。",
            };
    await route.fulfill({ json: { choices: [{ message }] } });
  });
  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "huiqi-ai-config",
        JSON.stringify({
          endpoint: "https://recovery-ai.example/v1",
          model: "test",
          mode: "tools",
          remember: false,
        }),
      );
      sessionStorage.setItem("huiqi-ai-key", "mock-secret");
    });
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page
      .getByLabel("发送给 AI 助手")
      .fill("核实碧翠丝的生日，修改默认提前7天提醒");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => stalled).toBe(true);
    await expect(page.getByLabel("实际工具执行记录")).toContainText(
      "已读取：作者のコメント",
    );
    await page.getByRole("button", { name: "取消请求", exact: true }).click();
    await expect(page.getByLabel("继续未完成操作")).toContainText(
      "已保留 1 篇资料与 1 批已保存修改",
    );
    release();
    await page.reload();
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(page.getByLabel("继续未完成操作")).toBeVisible();
    await expect(page.locator(".operation-result")).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/assistant-recovery-mobile.png",
      fullPage: false,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "继续本次操作", exact: true })
      .click();
    await expect(
      page.getByText("已保存核实结论，碧翠丝生日未公开，未填写猜测日期。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(reads).toBe(1);
    await expect(page.locator(".operation-result")).toHaveCount(2);
    await expect(page.getByLabel("继续未完成操作")).toHaveCount(0);
    await page.getByRole("button", { name: "关闭助手", exact: true }).click();
    await page.locator("nav").getByRole("button", { name: "角色库" }).click();
    const character = page
      .locator(".character-card")
      .filter({ hasText: "碧翠丝" });
    await expect(character).toContainText("生日未公开");
    await character.locator(".character-cover").click();
    await expect(page.getByLabel("生日月")).toHaveValue("");
    await expect(
      page.getByRole("dialog", { name: "编辑角色 · 碧翠丝" }),
    ).toContainText(quote);
  } finally {
    release();
  }
});

test("AI 实际流式传输在结束前显示中文，取消保留中断标记和正常转速", async ({
  page,
}) => {
  let finish = () => {};
  const received: any[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received.push(JSON.parse(raw));
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write(
      'data: {"choices":[{"index":0,"delta":{"content":"第一段中文回复"},"finish_reason":null}]}\n\n',
    );
    if (received.length === 1) {
      await new Promise<void>((done) => {
        finish = done;
      });
      res.end(
        'data: {"choices":[{"index":0,"delta":{"content":"，后续内容"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  try {
    await page.goto("/");
    await page.evaluate((endpoint) => {
      localStorage.setItem(
        "huiqi-ai-config",
        JSON.stringify({
          endpoint,
          model: "stream-test",
          mode: "tools",
          remember: false,
        }),
      );
      sessionStorage.setItem("huiqi-ai-key", "mock-secret");
    }, `http://127.0.0.1:${port}/v1`);
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page.getByLabel("发送给 AI 助手").fill("你好");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByLabel("流式回复")).toContainText("第一段中文回复");
    await expect(page.getByLabel("聊天模型")).toBeDisabled();
    expect(received[0].stream).toBe(true);
    expect(
      await page
        .locator(".chat-thinking .spin")
        .evaluate((el) => getComputedStyle(el).animationDuration),
    ).toBe("2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".chat-thinking .spin")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("spin");
    expect(
      await page
        .locator(".chat-thinking .spin")
        .evaluate((el) => getComputedStyle(el).animationDuration),
    ).toBe("3s");
    const reducedTransform = await page
      .locator(".chat-thinking .spin")
      .evaluate((el) => getComputedStyle(el).transform);
    await expect
      .poll(() =>
        page
          .locator(".chat-thinking .spin")
          .evaluate((el) => getComputedStyle(el).transform),
      )
      .not.toBe(reducedTransform);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.screenshot({
      path: "test-results/assistant-streaming-desktop.png",
      fullPage: true,
    });
    finish();
    await expect(page.locator(".chat-message.assistant")).toContainText(
      "第一段中文回复，后续内容",
    );
    await expect(page.getByLabel("流式回复")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("发送给 AI 助手").fill("第二次请求");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByLabel("流式回复")).toContainText("第一段中文回复");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/assistant-streaming-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "取消请求", exact: true }).click();
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "回复中断",
    );
    await expect(page.getByLabel("聊天模型")).toBeEnabled();
    await page.reload();
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "回复中断",
    );
  } finally {
    finish();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("AI 网页查询和设置修改显示真实结果，明确生日直接写入并展示来源和撤销", async ({
  page,
}) => {
  const source = "https://evidence.example/chtholly";
  const quote =
    "珂朵莉 Birthday: December 5. Gregorian calendar, WorldEnd character.";
  let round = 0;
  await page.route("**/__huiqi_web/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("search")
        ? {
            success: true,
            query: "珂朵莉 生日",
            provider: "Bing",
            results: [
              { title: "珂朵莉角色资料", url: source, snippet: "生日资料" },
            ],
          }
        : {
            success: true,
            url: source,
            title: "珂朵莉角色资料",
            text: quote,
            truncated: false,
          },
    }),
  );
  await page.route("https://web-ai.example/**", (route) => {
    const body = route.request().postDataJSON();
    const state = JSON.parse(body.messages[0].content.split("资料：")[1]);
    const character = state.characters.find((c: any) => c.name === "珂朵莉");
    const call = (name: string, args: unknown) => ({
      id: name,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
    round++;
    if (round === 4)
      return route.fulfill({
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "生日和提醒已保存，可撤销",
              },
            },
          ],
        },
      });
    const calls =
      round === 1
        ? [
            call("search_web", { query: "珂朵莉 生日" }),
            call("apply_changes", {
              summary: "修改默认提醒",
              changes: [
                {
                  collection: "settings",
                  action: "put",
                  data: { reminderDays: 7 },
                },
              ],
            }),
          ]
        : round === 2
          ? [call("read_web", { url: source })]
          : [
              call("propose_web_birthdays", {
                birthdays: [
                  {
                    characterId: character.id,
                    month: 12,
                    day: 5,
                    sourceUrl: source,
                    quote,
                  },
                ],
              }),
            ];
    return route.fulfill({
      json: {
        choices: [
          { message: { role: "assistant", content: null, tool_calls: calls } },
        ],
      },
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({
        endpoint: "https://web-ai.example/v1",
        model: "test",
        mode: "tools",
        remember: false,
      }),
    );
    sessionStorage.setItem("huiqi-ai-key", "mock-secret");
  });
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page
    .getByLabel("发送给 AI 助手")
    .fill("直接搜索网页补珂朵莉生日，默认提前7天提醒");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("实际工具执行记录")).toContainText(
    "已搜索：珂朵莉 生日",
  );
  await expect(page.getByLabel("实际工具执行记录")).toContainText(
    "已读取：珂朵莉角色资料",
  );
  await expect(page.getByLabel("实际工具执行记录")).toContainText(
    "已保存：修改默认提醒",
  );
  await expect(page.locator(".birthday-evidence")).toContainText(quote);
  await expect(page.locator(".birthday-evidence a")).toHaveAttribute(
    "href",
    source,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/assistant-web-birthday-mobile.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "确认应用", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".operation-result")).toHaveCount(2);
  await page.getByRole("button", { name: "关闭助手", exact: true }).click();

  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(
    page.locator(".character-card").filter({ hasText: "珂朵莉" }),
  ).toContainText("12 / 5");
});

test("上游模型多选保存，聊天切换使用所选模型且刷新保留", async ({ page }) => {
  const usedModels: string[] = [];
  let finishSecondRequest: (() => void) | undefined;
  await page.route("https://models.example.test/v1/**", async (route) => {
    if (route.request().url().endsWith("/models")) {
      expect(route.request().method()).toBe("GET");
      expect(route.request().headers().authorization).toBe(
        "Bearer session-key",
      );
      return route.fulfill({
        json: {
          data: [{ id: "model-a" }, { id: "model-b" }, { id: "model-a" }],
        },
      });
    }
    usedModels.push(route.request().postDataJSON().model);
    if (usedModels.length === 2)
      await new Promise<void>((resolve) => {
        finishSecondRequest = resolve;
      });
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              role: "assistant",
              content: `本次模型 ${usedModels.at(-1)}`,
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://models.example.test/v1/");
  await page.getByLabel("API Key", { exact: true }).fill("session-key");
  await page
    .getByRole("button", { name: "从上游获取模型", exact: true })
    .click();
  const options = page.getByRole("group", { name: "上游模型多选" });
  await expect(options.getByRole("checkbox")).toHaveCount(2);
  await options.getByLabel("model-a", { exact: true }).check();
  await options.getByLabel("model-b", { exact: true }).check();
  await page.getByLabel("默认模型").selectOption("model-a");
  await page.getByLabel("筛选上游模型").fill("model-b");
  await expect(options.getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.getByLabel("筛选上游模型").fill("");
  await page.screenshot({
    path: "test-results/model-settings.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByLabel("聊天模型")).toHaveValue("model-a");
  await page.getByLabel("发送给 AI 助手").fill("查询近期主题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("本次模型 model-a", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("聊天模型").selectOption("model-b");
  await page.getByLabel("发送给 AI 助手").fill("再查询一次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("聊天模型")).toBeDisabled();
  await expect.poll(() => !!finishSecondRequest).toBe(true);
  finishSecondRequest!();
  await expect(
    page.getByText("本次模型 model-b", { exact: true }),
  ).toBeVisible();
  expect(usedModels).toEqual(["model-a", "model-b"]);
  const stored = await page.evaluate(() =>
    localStorage.getItem("huiqi-ai-config"),
  );
  expect(JSON.parse(stored!)).toMatchObject({ key: "session-key", remember: true });
  await page.reload();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByLabel("聊天模型")).toHaveValue("model-b");
  await expect(page.getByLabel("聊天模型").locator("option")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "test-results/mobile-model-switch.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("模型列表获取失败保留已选模型，手动名称可供聊天选择", async ({ page }) => {
  await page.route("https://models.example.test/**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: "private upstream error" } },
    }),
  );
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://models.example.test/v1");
  await page.getByLabel("API Key", { exact: true }).fill("session-key");
  await page.getByLabel("模型", { exact: true }).fill("manual-model");
  await page
    .getByRole("button", { name: "从上游获取模型", exact: true })
    .click();
  await expect(page.locator(".settings-section .error")).toContainText(
    "密钥无效或没有模型列表权限",
  );
  await expect(page.getByLabel("模型", { exact: true })).toHaveValue(
    "manual-model",
  );
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByLabel("聊天模型")).toHaveValue("manual-model");
});

test("启动时不弹窗；搜索 Bangumi 连不上才提示 VPN，可重试，AniList备用补齐匹配角色", async ({
  page,
}) => {
  await page.route("https://api.bgm.tv/**", (route) => route.abort());
  let available = false;
  await page.route("https://graphql.anilist.co/**", (route) =>
    available
      ? route.fulfill({
          json: {
            data: {
              Page: {
                characters: [
                  {
                    id: 999,
                    name: {
                      full: "Beatrice",
                      native: "ベアトリス",
                      alternative: [],
                    },
                    image: { large: null, medium: null },
                    dateOfBirth: { year: null, month: 1, day: 10 },
                    media: {
                      nodes: [
                        {
                          title: {
                            romaji: "Re:Zero kara Hajimeru Isekai Seikatsu",
                            english: null,
                            native: null,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        })
      : route.abort(),
  );
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect(
    page.getByRole("dialog", { name: "角色资料网络连接失败" }),
  ).toHaveCount(0);
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByPlaceholder("输入角色名、Bangumi ID 或链接").fill("碧翠丝");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "角色资料网络连接失败" }),
  ).toContainText("VPN／代理");
  await page.screenshot({
    path: "test-results/network-dialog.png",
    fullPage: true,
  });
  available = true;
  await page
    .getByRole("button", { name: "已开启 VPN，重试", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "角色资料网络连接失败" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(
    page
      .locator(".character-card")
      .filter({ hasText: "碧翠丝" })
      .locator(".cover-date"),
  ).toHaveText("1 / 10");
});

test("AniList中文查询先读取Bangumi英文别名，显示英文关键词并确认导入", async ({
  page,
}) => {
  const candidate = {
    id: 888,
    name: { full: "Test Character", native: "测试角色", alternative: [] },
    image: { large: null, medium: null },
    dateOfBirth: { year: null, month: 2, day: 12 },
    media: { nodes: [] },
  };
  let searchedName = "";
  await page.route("https://api.bgm.tv/v0/search/**", (route) =>
    route.fulfill({ json: { data: [{ id: 777, name: "日文角色" }] } }),
  );
  await page.route("https://api.bgm.tv/v0/characters/777", (route) =>
    route.fulfill({
      json: {
        id: 777,
        name: "日文角色",
        infobox: [
          { key: "简体中文名", value: "测试角色" },
          { key: "别名", value: [{ k: "英文名", v: "Test Character" }] },
        ],
      },
    }),
  );
  await page.route("https://api.bgm.tv/v0/characters/777/subjects", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("https://graphql.anilist.co/**", (route) => {
    const variables = route.request().postDataJSON().variables;
    if (variables.search) searchedName = variables.search;
    return route.fulfill({
      json: {
        data: { Page: { characters: [candidate] }, Character: candidate },
      },
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByRole("group", { name: "角色资料来源", exact: true }).getByRole("button", { name: "AniList", exact: true }).click();
  await page
    .getByPlaceholder("输入英文角色名、AniList ID 或链接")
    .fill("测试角色");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByPlaceholder("输入英文角色名、AniList ID 或链接"),
  ).toHaveValue("Test Character");
  expect(searchedName).toBe("Test Character");
  await page.locator(".bangumi-results .result-row").first().click();
  await page.getByRole("button", { name: "确认关联" }).last().click();
  await expect(page.locator(".character-card")).toHaveCount(18);
  // 默认按生日临近排序，新导入的角色不一定在最后，按名字找
  await page
    .locator(".character-card")
    .filter({ hasText: "测试角色" })
    .locator(".character-cover")
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "https://anilist.co/character/888",
  );
  await expect(page.getByLabel("生日月")).toHaveValue("2");
});

test("从 Bangumi 切换到 AniList：直接用已选角色的英文名搜索", async ({ page }) => {
  const bgm = {
    id: 777,
    name: "日文角色",
    infobox: [
      { key: "简体中文名", value: "测试角色" },
      { key: "别名", value: [{ k: "英文名", v: "Test Character" }] },
    ],
  };
  const candidate = {
    id: 888,
    name: { full: "Test Character", native: "测试角色", alternative: [] },
    image: { large: null, medium: null },
    dateOfBirth: { year: null, month: 2, day: 12 },
    media: { nodes: [] },
  };
  const searched: string[] = [];
  await page.route("https://api.bgm.tv/v0/search/**", (route) =>
    route.fulfill({ json: { data: [bgm] } }),
  );
  await page.route("https://api.bgm.tv/v0/characters/777/subjects", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("https://graphql.anilist.co/**", (route) => {
    const variables = route.request().postDataJSON().variables;
    if (variables.search) searched.push(variables.search);
    return route.fulfill({
      json: { data: { Page: { characters: [candidate] }, Character: candidate } },
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByPlaceholder("输入角色名、Bangumi ID 或链接").fill("测试角色");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".bangumi-results .result-row").first().click();
  await page.getByRole("group", { name: "角色资料来源", exact: true }).getByRole("button", { name: "AniList", exact: true }).click();
  await expect(
    page.getByPlaceholder("输入英文角色名、AniList ID 或链接"),
  ).toHaveValue("Test Character");
  await expect(page.locator(".bangumi-results .result-row")).toHaveCount(1);
  expect(searched).toContain("Test Character");
});

test("Bangumi 不可访问时仍有14位生日，日历显示生日事项；启动时不弹网络提示", async ({ page }) => {
  await page.route("https://api.bgm.tv/**", (route) => route.abort());
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect(
    page.getByRole("dialog", { name: "角色资料网络连接失败" }),
  ).toHaveCount(0);
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(
    page.locator(".cover-date").filter({ hasText: "生日待确认" }),
  ).toHaveCount(3);
  await expect(
    page
      .locator(".character-card")
      .filter({ hasText: "香风智乃" })
      .locator(".cover-date"),
  ).toHaveText("12 / 4");
  await page
    .locator("nav")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await expect(page.locator(".calendar-event.birthday")).toContainText([
    "灰之魔女",
  ]);
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(
    page.locator(".cover-date").filter({ hasText: "生日待确认" }),
  ).toHaveCount(3);
  await expect(
    page.getByRole("dialog", { name: "角色资料网络连接失败" }),
  ).toHaveCount(0);
  await page
    .locator(".character-card")
    .filter({ hasText: "香风智乃" })
    .locator(".character-cover")
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "内置已核对资料（2026-10-10）",
  );
});

test("旧数据库升级保留手动生日和原始 Tag", async ({ page }) => {
  const character = newCharacter("伊莉雅", "prisma illya, (winter:1.2)");
  character.id = "seed-2";
  character.birthday = { month: 1, day: 2 };
  character.birthdayConfidence = "confirmed";
  const { birthdayFetchedAt, ...oldCharacter } = character;
  const { theme, ...oldSettings } = defaults;
  await page.addInitScript(
    ({ character, settings }) => {
      const request = indexedDB.open("huiqi-calendar", 10);
      request.onupgradeneeded = () => {
        for (const name of [
          "characters",
          "events",
          "tasks",
          "recommendations",
          "settings",
          "logs",
          "chats",
        ])
          request.result.createObjectStore(name, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(
          ["characters", "settings"],
          "readwrite",
        );
        tx.objectStore("characters").put(character);
        tx.objectStore("settings").put(settings);
        tx.oncomplete = () => database.close();
      };
    },
    { character: oldCharacter, settings: oldSettings },
  );
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(page.locator(".cover-date").first()).toHaveText("1 / 2");
  const saved = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("huiqi-calendar");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const character = await new Promise<any>((resolve) => {
      const request = database
        .transaction("characters")
        .objectStore("characters")
        .get("seed-2");
      request.onsuccess = () => resolve(request.result);
    });
    const version = database.version;
    database.close();
    return { character, version };
  });
  expect(saved.version).toBe(80);
  expect(saved.character.bangumiId).toBe(183099);
  expect(saved.character.birthdayFetchedAt).toBe("");
  expect(saved.character.presets[0].positive).toBe(
    "prisma illya, (winter:1.2)",
  );
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await expect(page.getByLabel("外观主题")).toHaveValue("system");
});

test("系统夜间主题实时切换，手动主题可覆盖", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "test-results/dark-home.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("外观主题").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("点击空白日期创建、查看和编辑任务或日程", async ({ page }) => {
  await page.goto("/");
  await page
    .locator("nav")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  const date = "2026-10-12";
  const panel = page.getByRole("complementary", { name: "当日安排" });
  await page.getByRole("button", { name: `查看 ${date}`, exact: true }).click();
  await expect(panel).toContainText("这一天还没有安排");
  await panel.getByRole("button", { name: "在此日新建任务" }).click();
  await expect(page.getByLabel("目标日期")).toHaveValue(date);
  await page.getByLabel("创作主题").fill("指定日创作");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.getByRole("button", { name: `查看 ${date}`, exact: true }).click();
  await expect(panel).toContainText("指定日创作");
  await panel.getByRole("button", { name: "编辑 指定日创作", exact: true }).click();
  await page.getByLabel("创作主题").fill("修改后的创作");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.getByRole("button", { name: `查看 ${date}`, exact: true }).click();
  await panel.getByRole("button", { name: "在此日添加日程" }).click();
  await expect(page.getByLabel("日期", { exact: true })).toHaveValue(date);
  await page.getByLabel("标题", { exact: true }).fill("当天纪念");
  await page.getByRole("button", { name: "保存节日" }).click();
  await page.getByRole("button", { name: "当天纪念", exact: true }).click();
  await expect(panel).toContainText("修改后的创作");
  await panel.getByRole("button", { name: "编辑 当天纪念", exact: true }).click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "当天纪念",
  );
});
test("生日后台自动获取，字体放大，手机夜间日历无溢出", async ({ page }) => {
  await page.route("https://api.bgm.tv/v0/characters/*", (route) => {
    const id = Number(route.request().url().split("/").at(-1));
    return route.fulfill({
      json: {
        id,
        name: "测试角色",
        birth_mon: 12,
        birth_day: 4,
        infobox: [{ key: "生日", value: "12月4日" }],
      },
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  // 默认按生日临近排序，后台补上的 12/4 不在第一张卡上
  await expect(
    page.locator(".cover-date").filter({ hasText: /^12 \/ 4$/ }).first(),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  expect(
    await page
      .locator(".calendar-event")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(13);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(350);
  expect(
    await page
      .locator(".calendar-event")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dark-mobile-calendar.png",
    fullPage: true,
  });
});
test("角色、节日、复制 Tag 和任务完整流程", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1.hero-narration")).toContainText("。");
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(page.locator(".character-card")).toHaveCount(17);
  await page
    .locator(".character-card")
    .filter({ hasText: "洛琪希" })
    .locator(".character-cover")
    .click();
  await page.getByLabel("生日月").fill("12");
  await page.getByLabel("生日日").fill("5");
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const roxy = page.locator(".character-card").filter({ hasText: "洛琪希" });
  await roxy.getByRole("button", { name: "复制 Tag · 洛琪希" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已复制「洛琪希」的 Tag");
  await expect(roxy.getByRole("button", { name: "复制 Tag · 洛琪希" })).toHaveText(
    "已复制",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Roxy migurdia, ( jitome:0.8),  frills, dress, white dress, ahoge, bare shoulders",
  );
  await page.locator("nav").getByRole("button", { name: "创作任务" }).click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("创作主题").fill("洛琪希冬日创作");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await expect(page.getByText("洛琪希冬日创作", { exact: true })).toBeVisible();
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "创作任务" }).click();
  await expect(page.getByText("洛琪希冬日创作", { exact: true })).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "日历", exact: true })
    .click();
  await page.getByRole("button", { name: "添加日程", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("双十一创作日");
  await page.getByLabel("月份").fill("11");
  await page.getByLabel("日期", { exact: true }).fill("11");
  await page.getByRole("button", { name: "保存节日" }).click();
  await page.getByRole("button", { name: "下个月" }).click();
  await expect(
    page.getByRole("button", { name: "双十一创作日" }),
  ).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前事项" }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.ics$/);
  await page.screenshot({
    path: "test-results/desktop-calendar.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("手机布局无横向溢出，角色与 AI 助手可访问", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("h1.hero-narration")).toContainText("。");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });

  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(page.locator(".character-card")).toHaveCount(17);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-characters.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "AI 创作助手" })).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-assistant.png",
    fullPage: true,
  });
});

test("备份下载后确认恢复、数据持久化", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  const waitDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await waitDownload;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(
    page.getByRole("dialog", { name: "确认导入备份" }),
  ).toBeVisible();
  await expect(
    page.getByText("新增 0 条，更新 17 条资料。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("备份已恢复");
});

test("Bangumi 候选确认后导入，生日来源可查看", async ({ page }) => {
  await page.route("https://api.bgm.tv/v0/**", (route) => {
    const character = {
      id: 46465,
      name: "ロキシー・ミグルディア",
      birth_mon: 3,
      birth_day: 3,
      images: {
        medium: "https://lain.bgm.tv/r/400/pic/crt/l/fe/d5/46465_crt_EByBv.jpg",
      },
      infobox: [
        { key: "简体中文名", value: "测试洛琪希" },
        { key: "生日", value: "甲龙历373年" },
      ],
    };
    return route.fulfill({
      json: route.request().url().includes("/subjects")
        ? [{ name_cn: "无职转生" }]
        : route.request().url().includes("/search/")
          ? { data: [character] }
          : character,
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByPlaceholder("输入角色名、Bangumi ID 或链接").fill("洛琪希");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".bangumi-results .result-row").first().click();
  await page.getByRole("button", { name: "确认关联" }).last().click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已添加角色「测试洛琪希」");
  await page
    .locator(".character-card")
    .filter({ hasText: "测试洛琪希" })
    .locator(".character-cover")
    .click();
  await expect(
    page.getByRole("dialog", { name: "编辑角色 · 测试洛琪希" }),
  ).toBeVisible();
  await expect(page.getByLabel("生日月")).toHaveValue("");
});

test("点选候选立刻展开预览，作品稍后补上；读取期间不能确认", async ({ page }) => {
  const character = {
    id: 46465,
    name: "ロキシー・ミグルディア",
    images: { medium: "https://lain.bgm.tv/r/400/pic/crt/l/fe/d5/46465_crt_EByBv.jpg" },
    infobox: [{ key: "简体中文名", value: "洛琪希" }],
  };
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://api.bgm.tv/v0/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/search/")) return route.fulfill({ json: { data: [character] } });
    if (url.includes("/subjects")) {
      await gate;
      return route.fulfill({ json: [{ name_cn: "无职转生" }] });
    }
    return route.fulfill({ json: character });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByPlaceholder("输入角色名、Bangumi ID 或链接").fill("洛琪希");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".bangumi-results .result-row").first().click();
  await expect(page.getByText("正在读取出现作品…")).toBeVisible();
  await expect(page.locator(".import-selection")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认关联" }).last()).toBeDisabled();
  release();
  await expect(page.locator(".preview-info")).toContainText("无职转生");
  await expect(page.getByRole("button", { name: "确认关联" }).last()).toBeEnabled();
});

test("AI 工具调用保存，删除确认，操作可撤销", async ({ page }) => {
  let round = 0;
  await page.route("https://ai.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    round++;
    let message =
      round === 1
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "test1",
                type: "function",
                function: {
                  name: "apply_changes",
                  arguments: JSON.stringify({
                    summary: "新增双十一",
                    changes: [
                      {
                        collection: "events",
                        action: "put",
                        data: {
                          title: "AI 双十一",
                          recurrence: "solar",
                          month: 11,
                          day: 11,
                        },
                      },
                    ],
                  }),
                },
              },
            ],
          }
        : { role: "assistant", content: "已保存 AI 双十一。" };
    if (round === 3) {
      const state = JSON.parse(body.messages[0].content.split("资料：")[1]);
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "delete1",
            type: "function",
            function: {
              name: "apply_changes",
              arguments: JSON.stringify({
                summary: "删除 AI 双十一",
                changes: [
                  {
                    collection: "events",
                    action: "delete",
                    id: state.events[0].id,
                  },
                ],
              }),
            },
          },
        ],
      };
    }
    await route.fulfill({ json: { choices: [{ message }] } });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://ai.example.test/v1");
  await page.getByLabel("模型", { exact: true }).fill("test");
  await page.getByLabel("API Key", { exact: true }).fill("test");
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page.getByLabel("发送给 AI 助手").fill("新增每年11月11日的AI双十一");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("已保存 AI 双十一。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".operation-result")).toHaveCount(1);
  await page.getByLabel("发送给 AI 助手").fill("删除刚才的 AI 双十一");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".change-preview")).toContainText(
    "删除「AI 双十一」",
  );
  await expect(page.getByLabel("聊天模型")).toBeDisabled();
  await page.getByRole("button", { name: "确认应用", exact: true }).click();
  await expect(page.locator(".operation-result")).toHaveCount(1);
  await page
    .locator(".operation-result")
    .getByRole("button", { name: "撤销本次操作" })
    .click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已撤销");
});

test("助手一轮工具后：等待提示和回复在工具记录下面；模型没给总结时列出已保存的修改；消息可复制", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let round = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://ai.example.test/**", async (route) => {
    round++;
    if (round === 2) await gate;
    const message =
      round === 1
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "add",
                type: "function",
                function: {
                  name: "apply_changes",
                  arguments: JSON.stringify({
                    summary: "新增节日",
                    changes: [
                      {
                        collection: "events",
                        action: "put",
                        data: { title: "测试节", recurrence: "solar", month: 5, day: 5 },
                      },
                    ],
                  }),
                },
              },
            ],
          }
        : { role: "assistant", content: "   " };
    await route.fulfill({ json: { choices: [{ message }] } });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://ai.example.test/v1");
  await page.getByLabel("模型", { exact: true }).fill("test");
  await page.getByLabel("API Key", { exact: true }).fill("test");
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page.getByLabel("发送给 AI 助手").fill("新增 5 月 5 日测试节");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  // 第一轮工具完成、模型还在整理：等待提示排在工具记录之后，能看到
  const thinking = page.locator(".chat-thinking");
  await expect(thinking).toContainText("第 1 轮工具已完成");
  const after = await page.evaluate(() => {
    const tools = document.querySelector(".tool-activity")!;
    const wait = document.querySelector(".chat-thinking")!;
    return !!(tools.compareDocumentPosition(wait) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(after).toBe(true);
  release();
  const reply = page.locator(".chat-message.assistant").last();
  await expect(reply).toContainText("模型没有返回总结。本次已保存 1 批修改");
  const replyAfterTools = await page.evaluate(() => {
    const tools = document.querySelector(".tool-activity")!;
    const replies = document.querySelectorAll(".chat-message.assistant");
    return !!(tools.compareDocumentPosition(replies[replies.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(replyAfterTools).toBe(true);
  // 结束后工具记录默认折叠，标题显示进度
  await expect(page.locator(".tool-activity")).not.toHaveAttribute("open", "");
  await expect(page.locator(".tool-activity summary")).toContainText("1 / 1 项完成");
  await page.locator(".chat-message.user").last().hover();
  await page.getByRole("button", { name: "复制我的消息" }).last().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("新增 5 月 5 日测试节");
  await page.locator(".assistant-panel").screenshot({ path: "test-results/assistant-after-round.png" });
});

test("助手：往上翻看历史时，新内容不会把窗口拉回底部；自己发消息时回到底部", async ({ page }) => {
  let round = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://ai.example.test/**", async (route) => {
    round++;
    if (round === 2) await gate;
    const content =
      round === 1
        ? Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行`).join(String.fromCharCode(10))
        : "第二次回复";
    await route.fulfill({ json: { choices: [{ message: { role: "assistant", content } }] } });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://ai.example.test/v1");
  await page.getByLabel("模型", { exact: true }).fill("test");
  await page.getByLabel("API Key", { exact: true }).fill("test");
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  const box = page.getByLabel("发送给 AI 助手");
  await box.fill("先来一段长回复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("第 60 行", { exact: false })).toBeVisible();
  const scroller = page.locator(".chat-scroll");
  const atBottom = () =>
    scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  expect(await atBottom()).toBe(true);
  await box.fill("再来一次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-thinking")).toBeVisible();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  release();
  await expect(page.getByText("第二次回复")).toBeAttached();
  await page.waitForTimeout(300);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(40);
  await box.fill("第三次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-message.user").last()).toContainText("第三次");
  await expect.poll(atBottom).toBe(true);
});

test("标星可在首页、角色库筛选并刷新保留；添加窗口分节日与角色两页", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  // 首页近期生日：给露露卡（11/1）标星后，「仅标星」只剩她
  const luluka = page.locator(".birthday-card").filter({ hasText: "露露卡" });
  await luluka.getByRole("button", { name: "标星 露露卡" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已标星「露露卡」");
  await page.getByLabel("仅标星").check();
  await expect(page.locator(".birthday-card")).toHaveCount(1);
  await expect(page.locator(".birthday-card")).toContainText("露露卡");
  await page.reload();
  await page.getByLabel("仅标星").check();
  await expect(page.locator(".birthday-card")).toHaveCount(1);
  // 角色库：统一显示「N 天后」，没有 No. 序号；标星筛选与复制按钮文字
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(page.locator(".cc-index")).toHaveCount(0);
  await expect(
    page.locator(".character-card").filter({ hasText: "露露卡" }).locator(".cc-soon"),
  ).toContainText("天后");
  await page.getByRole("button", { name: "角色排序" }).click();
  await page.getByRole("option", { name: "标星优先" }).click();
  await expect(page.getByRole("button", { name: "角色排序" })).toContainText(
    "标星优先",
  );
  await expect(page.locator(".character-card").first()).toContainText("露露卡");
  await page.getByLabel("仅标星").check();
  await expect(page.locator(".character-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "复制 Tag · 露露卡" })
    .click();
  await expect(page.getByRole("button", { name: "复制 Tag · 露露卡" })).toHaveText(
    "已复制",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "moria luluka, cure arcana shadow",
  );
  // 添加窗口：自定义节日 / 角色 两页，角色页带搜索与「手动添加角色」
  await page.locator("nav").getByRole("button", { name: "创作工作台" }).click();
  await page.getByRole("button", { name: "添加日程", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab").first()).toHaveText("角色");
  await expect(dialog.getByRole("tab", { name: "角色" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog).toHaveAttribute("aria-label", "添加角色");
  await dialog.getByRole("tab", { name: "自定义节日" }).click();
  await expect(dialog).toHaveAttribute("aria-label", "添加自定义节日");
  await dialog.getByRole("tab", { name: "角色" }).click();
  await expect(dialog.getByRole("button", { name: "手动添加角色" })).toBeVisible();
  await expect(dialog.getByPlaceholder("输入角色名、Bangumi ID 或链接")).toBeVisible();
});

test("添加角色自动获取 Tag：Tag 只含角色标签，人物特征另存，复制只复制 Tag", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const nahida = {
    id: 99001,
    name: "ナヒーダ",
    birth_mon: 10,
    birth_day: 27,
    images: {},
    infobox: [
      { key: "简体中文名", value: "纳西妲" },
      { key: "别名", value: [{ k: "英文名", v: "Nahida" }] },
      { key: "生日", value: "10月27日" },
    ],
  };
  await page.route("https://api.bgm.tv/v0/**", (route) => {
    const url = route.request().url();
    return route.fulfill({
      json: url.includes("/subjects")
        ? [{ name_cn: "原神" }]
        : url.includes("/search/")
          ? { data: [nahida] }
          : nahida,
    });
  });
  await page.route("**/__huiqi_character/api", (route) => {
    const body = route.request().postDataJSON();
    if (body.source === "Danbooru" && body.action === "tags")
      return route.fulfill({
        json: [{ name: "nahida_(genshin_impact)", post_count: 41000 }],
      });
    if (body.source === "Danbooru" && body.action === "related")
      return route.fulfill({
        json: {
          related_tags: [
            { tag: { name: "genshin_impact", category: 3 }, frequency: 0.99 },
            { tag: { name: "green_eyes", category: 0 }, frequency: 0.7 },
            { tag: { name: "white_hair", category: 0 }, frequency: 0.6 },
          ],
        },
      });
    return route.fulfill({ status: 503, json: { error: "测试环境不可用" } });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "添加日程", exact: true }).click();
  await page.getByPlaceholder("输入角色名、Bangumi ID 或链接").fill("纳西妲");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".result-row").first().click();
  await expect(page.locator(".tag-source")).toContainText("Danbooru");
  await expect(page.getByLabel("Tag", { exact: true })).toHaveValue(
    "nahida \\(genshin impact\\)",
  );
  await expect(page.getByRole("textbox", { name: "人物特征" })).toHaveValue(
    "green eyes, white hair",
  );
  await page.getByRole("button", { name: "确认关联" }).last().click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已添加角色「纳西妲」");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  const card = page.locator(".character-card").filter({ hasText: "纳西妲" });
  await card.getByRole("button", { name: "复制 Tag · 纳西妲" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "nahida \\(genshin impact\\)",
  );
  // 人物特征单独保存在角色资料里，刷新后仍在
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await card.locator(".character-cover").click();
  await expect(page.getByRole("textbox", { name: "人物特征" })).toHaveValue(
    "green eyes, white hair",
  );
});

test("首页寿星卡：留言区提示配置 AI，三个纯图标按钮；创作队列在灵感上方，节日行没有图标", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const spotlight = page.getByRole("complementary", { name: "下一位寿星" });
  await expect(spotlight).toContainText("配置 AI 接口后");
  await expect(spotlight.locator(".spot-count")).toHaveCount(0);
  await expect(spotlight.getByRole("button", { name: "和角色聊天" })).toHaveText("AI");
  await expect(spotlight.getByRole("button", { name: "建任务" })).toHaveText("");
  await spotlight.getByRole("button", { name: "复制 Tag" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("已复制");
  // 版面：创作队列在「现在开始，刚刚好」上方；节日行没有彩炮图标；顶部不再有「生日待确认」
  const queueBox = await page.locator(".task-glance").boundingBox();
  const ideasBox = await page.locator(".ideas-section").boundingBox();
  expect(queueBox!.y).toBeLessThan(ideasBox!.y);
  await expect(page.locator(".holiday-row .event-mark")).toHaveCount(0);
  await expect(page.locator(".hero-stats")).not.toContainText("生日待确认");
  await expect(page.locator(".hero-stats")).toContainText("待完成创作");
  // 顶部大板块里不再有背景大字年份
  await expect(page.locator(".hero-year")).toHaveCount(0);
});

test("配置 AI 后预先存好多条角色留言：打开直接显示且每次不同；AI 按钮打开角色聊天，可推荐绘画 prompt", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://ai.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    const system = String(body.messages[0].content);
    calls++;
    const content = system.includes("Danbooru")
      ? '{"tag":"elaina \\\\(majo no tabitabi\\\\)","traits":"grey hair, witch hat","note":"把握较高"}'
      : JSON.stringify(["留言一。", "留言二。", "留言三。", "留言四。", "留言五。"]);
    await route.fulfill({
      json: { choices: [{ finish_reason: "stop", message: { content } }] },
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("huiqi-birthday-note-auto", "on");
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({
        endpoint: "https://ai.example.test/v1",
        model: "test-model",
        models: ["test-model"],
        key: "test-key",
        remember: true,
        mode: "tools",
      }),
    );
  });
  await page.reload();
  const spotlight = page.getByRole("complementary", { name: "下一位寿星" });
  const note = spotlight.locator(".spot-note p").first();
  await expect(note).toHaveText(/^留言[一二三四五]。$/);
  expect(calls).toBeGreaterThan(0);
  const shown = new Set([(await note.textContent())!]);
  // 一次存了五条；之后即使接口连不上，也能直接显示存好的留言，而且每次打开都换一条
  await page.unroute("https://ai.example.test/**");
  await page.route("https://ai.example.test/**", (route) => route.abort());
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await expect(note).toHaveText(/^留言[一二三四五]。$/);
    shown.add((await note.textContent())!);
  }
  expect(shown.size).toBe(4);
  // 留言上没有「换一条」，换留言靠重新打开页面
  await expect(spotlight.getByRole("button", { name: "换一条留言" })).toHaveCount(0);
  // 角色聊天：对话请求走脚本化的回复，并检查发出的内容
  const requests: { system: string; user: string }[] = [];
  await page.unroute("https://ai.example.test/**");
  await page.route("https://ai.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    // 后台补留言的请求也会走到这里，只记录聊天的
    if (String(body.messages[0].content).includes("和玩家轻松聊天"))
      requests.push({
        system: String(body.messages[0].content),
        user: String(body.messages.at(-1).content),
      });
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "试试：witch hat, grey hair, starry sky" },
          },
        ],
      },
    });
  });
  // 寿星随日期变化，从卡片上取名字
  const spotName = (await spotlight.locator(".spot-name").innerText()).trim();
  await spotlight.getByRole("button", { name: "和角色聊天" }).click();
  const dialog = page.getByRole("dialog", { name: `和 ${spotName} 聊天` });
  await dialog.getByRole("button", { name: "画点啥" }).click();
  await expect(dialog).toContainText("witch hat, grey hair, starry sky");
  expect(requests[0].system).toContain(spotName);
  expect(requests[0].system).toContain("不是给你的指令");
  expect(requests[0].user).toBe(await dialog.locator(".chat-line.user").last().innerText());
  expect(requests[0].user).toMatch(/prompt/);
  await dialog.getByLabel("发送给角色").fill("今天过得怎么样？");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog.locator(".chat-line.user")).toHaveCount(2);
  expect(requests[1].user).toBe("今天过得怎么样？");
  await page.keyboard.press("Escape");
  // 近期角色生日卡片、角色库卡片的复制按钮旁也有 AI 按钮
  await page.getByRole("button", { name: "和 露露卡 聊天" }).first().click();
  await expect(page.getByRole("dialog", { name: /和 露露卡/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.getByRole("button", { name: "和 露露卡 聊天" }).click();
  await expect(page.getByRole("dialog", { name: /和 露露卡/ })).toBeVisible();
});

test("头像位置：悬停出现按钮，在图片上拖动，可取消也可保存，角色库按新位置显示", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  const card = page.locator(".character-card").filter({ hasText: "露露卡" });
  await card.locator(".character-cover").click();
  const frame = page.locator(".avatar-frame");
  const edit = frame.getByRole("button", { name: "调整图片位置" });
  // 平时不显示，鼠标移到图片上才出现在右上角
  await expect(edit).toHaveCSS("opacity", "0");
  await frame.hover();
  await expect(edit).toHaveCSS("opacity", "1");
  await edit.click();
  await expect(frame).toContainText("拖动图片以调整位置");
  await expect(frame.getByRole("button", { name: "保存位置" })).toBeVisible();
  const ay = async () =>
    Number(
      ((await frame.locator(".avatar").getAttribute("style")) ?? "").match(
        /--ay: ([\d.]+)%/,
      )![1],
    );
  const dragUp = async () => {
    const box = (await frame.locator(".frame-image").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, {
      steps: 5,
    });
    // 拖动过程中提示文字不消失，图片也没有被浏览器选中（选中会盖上一层蓝色）
    await expect(frame.getByText("拖动图片以调整位置")).toBeVisible();
    expect(await page.evaluate(() => String(getSelection()))).toBe("");
    await page.mouse.up();
  };
  // 取消：拖动后放弃，位置回到原来
  const original = await ay();
  await dragUp();
  expect(await ay()).toBeGreaterThan(original);
  await frame.getByRole("button", { name: "取消" }).click();
  await expect(frame).not.toContainText("拖动图片以调整位置");
  expect(await ay()).toBe(original);
  // 保存位置：放大后拖动，确认，再保存角色
  await frame.hover();
  await edit.click();
  await frame.getByLabel("缩放").fill("2");
  await dragUp();
  const moved = await ay();
  expect(moved).toBeGreaterThan(original);
  await frame.getByRole("button", { name: "保存位置" }).click();
  await expect(frame).not.toContainText("拖动图片以调整位置");
  expect(await ay()).toBe(moved);
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(card.locator(".avatar").first()).toHaveAttribute(
    "style",
    /--az: 2/,
  );
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await expect(
    page.locator(".character-card").filter({ hasText: "露露卡" }).locator(".avatar").first(),
  ).toHaveAttribute("style", /--az: 2/);
});

test("可以在设置里关闭首页留言的自动生成，之后手动收取", async ({ page }) => {
  let calls = 0;
  await page.route("https://ai.example.test/**", async (route) => {
    calls++;
    await route.fulfill({
      json: {
        choices: [
          { finish_reason: "stop", message: { content: "手动收到的一条留言。" } },
        ],
      },
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({
        endpoint: "https://ai.example.test/v1",
        model: "test-model",
        models: ["test-model"],
        key: "test-key",
        remember: true,
        mode: "tools",
      }),
    );
  });
  await page.reload();
  const spotlight = page.getByRole("complementary", { name: "下一位寿星" });
  await expect(spotlight).toContainText("已关闭自动生成留言");
  expect(calls).toBe(0);
  await spotlight.getByRole("button", { name: "收取留言" }).click();
  await expect(spotlight).toContainText("手动收到的一条留言。");
  expect(calls).toBe(1);
  // 设置里可重新打开
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await expect(page.getByLabel(/首页寿星卡自动生成角色留言/)).not.toBeChecked();
});

test("首页旁白不带日期：用角色与节日自然地报今天和接下来的日子", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-17T10:00:00+08:00"));
  await page.goto("/");
  const narration = page.locator("h1.hero-narration");
  await expect(narration.locator(".line-main")).toHaveText(
    "今天是灰之魔女（伊蕾娜）的生日。",
  );
  await expect(narration.locator(".line-sub")).toHaveText(
    "明天是重阳节，15 天后轮到露露卡。",
  );
  await expect(narration).not.toContainText("2026");
  await expect(page.locator(".hero-year")).toHaveCount(0);
  // 次日：今天没有生日，不特意说「没有」，直接从下一位寿星说起
  await page.clock.setFixedTime(new Date("2026-10-18T10:00:00+08:00"));
  await page.reload();
  await expect(narration.locator(".line-main")).toHaveText(
    "14 天后是露露卡的生日。",
  );
  await expect(narration.locator(".line-sub")).toContainText("重阳节");
});

test("寿星卡：图片压在后方窄矩形上，三个按钮与留言框同宽，留言没有边框", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const spotlight = page.getByRole("complementary", { name: "下一位寿星" });
  const box = (await spotlight.boundingBox())!;
  const portrait = (await spotlight.locator(".spot-portrait").boundingBox())!;
  // 图片卡比后方矩形更大，并且向左探出矩形之外
  expect(portrait.width).toBeGreaterThan(150);
  expect(portrait.x).toBeLessThan(box.x - 20);
  expect(portrait.x + portrait.width).toBeGreaterThan(box.x + 40);
  expect(box.width).toBeGreaterThan(400);
  expect(box.width).toBeLessThan(460);
  const note = (await spotlight.locator(".spot-note").boundingBox())!;
  const actions = (await spotlight.locator(".spot-actions").boundingBox())!;
  expect(Math.abs(actions.width - note.width)).toBeLessThan(1);
  expect(Math.abs(actions.x - note.x)).toBeLessThan(1);
  await expect(spotlight.locator(".spot-note")).toHaveCSS("border-top-width", "0px");
});

test("角色库默认按生日临近排序，添加顺序是倒序（最新在前）", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  const sort = page.getByRole("button", { name: "角色排序" });
  await expect(sort).toContainText("生日临近");
  // 生日临近：距离生日的天数从小到大
  const days = async () =>
    (await page.locator(".character-card .cc-soon").allTextContents()).map((t) =>
      t.includes("今天") ? 0 : Number(t.match(/\d+/)?.[0]),
    );
  const list = await days();
  expect(list.length).toBeGreaterThan(5);
  expect([...list].sort((a, b) => a - b)).toEqual(list);
  // 新添加一位角色：生日临近里没有生日的排在最后，添加顺序里它排第一
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByRole("button", { name: "手动添加角色", exact: true }).click();
  await page.getByLabel("角色名称").fill("新来的角色");
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  // 保存后会弹出「从 Bangumi 导入角色」，这里不需要，关掉
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".character-card").last()).toContainText("新来的角色");
  await sort.click();
  await page.getByRole("option", { name: "添加顺序（最新在前）" }).click();
  await expect(page.locator(".character-card").first()).toContainText("新来的角色");
});

test("中转站没开跨域：直连模型列表被拦下后，改由本机服务转发并列出模型", async ({
  page,
}) => {
  let relayed: Record<string, unknown> | undefined;
  // 直连被浏览器拦下（等同没有跨域头）；本机服务的转发路由返回模型列表
  await page.route("https://nocors.example.test/**", (route) => route.abort());
  await page.route("**/__huiqi_ai/relay", (route) => {
    relayed = route.request().postDataJSON();
    return route.fulfill({
      json: { data: [{ id: "relay-model-b" }, { id: "relay-model-a" }] },
    });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://nocors.example.test");
  await page.getByLabel("API Key", { exact: true }).fill("session-key");
  await page
    .getByRole("button", { name: "从上游获取模型", exact: true })
    .click();
  await expect(page.getByText("relay-model-a", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("relay-model-b", { exact: true }).first()).toBeVisible();
  expect(relayed).toMatchObject({
    url: "https://nocors.example.test/models",
    method: "GET",
    authorization: "Bearer session-key",
  });
  await expect(page.locator(".settings-section .error")).toHaveCount(0);
});

test("连接诊断：逐步显示直连、本机转发、对话测试各自的结果", async ({ page }) => {
  await page.route("https://diag.example.test/**", (route) => route.abort());
  await page.route("**/__huiqi_ai/relay", (route) => {
    const target = String(route.request().postDataJSON().url);
    return target.endsWith("/models")
      ? route.fulfill({ json: { data: [{ id: "m1" }, { id: "m2" }] } })
      : route.fulfill({
          status: 402,
          json: { error: { message: "Insufficient Balance" } },
        });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://diag.example.test");
  await page.getByLabel("API Key", { exact: true }).fill("session-key");
  await page.getByLabel("模型", { exact: true }).fill("some-model");
  await page.getByRole("button", { name: "连接诊断", exact: true }).click();
  const items = page.getByLabel("连接诊断结果").locator("li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("被浏览器拦下");
  await expect(items.nth(1)).toContainText("HTTP 200，2 个模型");
  await expect(items.nth(2)).toContainText("账户余额不足");
  await expect(items.nth(0)).toHaveClass(/bad/);
  await expect(items.nth(1)).toHaveClass(/ok/);
  expect(await page.getByLabel("连接诊断结果").innerText()).not.toContain("session-key");
});

test("角色聊天：对话按角色保存，重新打开还在；没有隐私说明文字；可清空", async ({
  page,
}) => {
  await page.route("https://ai.example.test/**", (route) =>
    route.fulfill({
      json: { choices: [{ finish_reason: "stop", message: { content: "好呀，一起去看星星。" } }] },
    }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({ endpoint: "https://ai.example.test/v1", model: "m", key: "k", remember: true, mode: "tools" }),
    );
  });
  await page.reload();
  const open = () => page.getByRole("complementary", { name: "下一位寿星" }).getByRole("button", { name: "和角色聊天" }).click();
  await open();
  const dialog = page.getByRole("dialog", { name: /聊天/ });
  await expect(dialog).not.toContainText("不含私人备注");
  await dialog.getByLabel("发送给角色").fill("晚上好");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog).toContainText("好呀，一起去看星星。");
  await page.keyboard.press("Escape");
  await page.reload();
  await open();
  await expect(page.getByRole("dialog", { name: /聊天/ })).toContainText("晚上好");
  await expect(page.getByRole("dialog", { name: /聊天/ })).toContainText("好呀，一起去看星星。");
  await page.getByRole("button", { name: "清空对话" }).click();
  await expect(page.locator(".chat-line")).toHaveCount(0);
});

test("聊天里生图：设置里配置生图接口后，按钮直接用预置提示词出图并显示在聊天窗口", async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("https://img.example.test/**", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: { data: [{ url: "https://img.example.test/out/0.png" }] },
    });
  });
  await page.route("https://img.example.test/out/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/");
  // 没配置时，生图按钮不可用
  await page.getByRole("complementary", { name: "下一位寿星" }).getByRole("button", { name: "和角色聊天" }).click();
  await expect(page.getByRole("button", { name: "生图", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("生图接口地址").fill("https://img.example.test/v1");
  await page.getByLabel("生图 API Key").fill("img-key");
  await page.getByLabel("生图模型").fill("gpt-image-2");
  await page.getByLabel("图片比例").selectOption("custom");
  await page.getByLabel("自定义尺寸").fill("1024x1024");
  await page.getByRole("button", { name: "保存生图配置" }).click();
  await page.locator("nav").getByRole("button", { name: "创作工作台" }).click();
  await page.getByRole("complementary", { name: "下一位寿星" }).getByRole("button", { name: "和角色聊天" }).click();
  await page.getByRole("button", { name: "生图", exact: true }).click();
  const image = page.locator(".chat-image");
  await expect(image).toBeVisible();
  expect(bodies[0]).toMatchObject({ model: "gpt-image-2", n: 1, size: "1024x1024" });
  expect(String(bodies[0].prompt)).toContain("masterpiece");
  // 输入框里有内容就用它生图
  await page.getByLabel("发送给角色").fill("sunset beach");
  await page.getByRole("button", { name: "生图", exact: true }).click();
  await expect(image).toHaveCount(2);
  expect(bodies[1].prompt).toBe("sunset beach");
});

test("设置里填好地址和密钥就自动获取模型；点获取模型先显示加载，拿到后直接展开选择", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://auto.example.test/v1/models", async (route) => {
    requests++;
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ json: { data: [{ id: "m-b" }, { id: "m-a" }] } });
  });
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("接口地址", { exact: true }).fill("https://auto.example.test/v1");
  await page.getByLabel("API Key", { exact: true }).fill("session-key-123");
  // 不点任何按钮，稍等就自动请求，但不会弹开下拉
  await expect.poll(() => requests, { timeout: 8000 }).toBe(1);
  await expect(page.getByRole("listbox", { name: "模型列表" })).toHaveCount(0);
  await expect(page.getByText("m-a", { exact: true }).first()).toBeVisible();
  // 手动点：先弹开并显示「正在获取模型…」，拿到后同一个下拉里直接列出模型
  await page.getByRole("button", { name: "从上游获取模型", exact: true }).click();
  const list = page.getByRole("listbox", { name: "模型列表" });
  await expect(list).toContainText("正在获取模型");
  await expect(list.getByRole("option", { name: "m-a" })).toBeVisible();
  await list.getByRole("option", { name: "m-b" }).click();
  await expect(page.getByLabel("模型", { exact: true })).toHaveValue("m-b");
});

test("聊天窗口：有头像和快捷输入；点生图只显示场景话；聊天中让角色拍照会按标记出图", async ({
  page,
}) => {
  const imageBodies: Record<string, unknown>[] = [];
  await page.route("https://ai.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    const system = String(body.messages[0].content);
    // 后台补留言的请求不管
    if (!system.includes("和玩家轻松聊天"))
      return route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: "[\"留言一。\"]" } }] } });
    expect(system).toContain("[[拍照:");
    return route.fulfill({
      json: {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                "好呀，笑一个～\n[[拍照: smiling, sitting by the window, soft light]]",
            },
          },
        ],
      },
    });
  });
  await page.route("https://img.example.test/v1/**", (route) => {
    imageBodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: [{ url: "https://img.example.test/out/p.png" }] } });
  });
  await page.route("https://img.example.test/out/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("huiqi-birthday-note-auto", "off");
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({ endpoint: "https://ai.example.test/v1", model: "m", key: "k", remember: true, mode: "tools" }),
    );
    localStorage.setItem(
      "huiqi-image-config",
      JSON.stringify({ kind: "images", endpoint: "https://img.example.test/v1", model: "gpt-image-2", key: "ik", remember: true, sizeMode: "random", syntax: "tags", prefix: "", suffix: "" }),
    );
  });
  await page.reload();
  await page.getByRole("complementary", { name: "下一位寿星" }).getByRole("button", { name: "和角色聊天" }).click();
  const dialog = page.getByRole("dialog", { name: /聊天/ });
  await expect(dialog.locator(".chat-head .avatar")).toBeVisible();
  const quick = dialog.getByRole("group", { name: "快捷输入" }).getByRole("button");
  await expect(quick).toHaveCount(5);
  // 点「生图」：聊天里只有一句场景话，没有提示词
  await dialog.getByRole("button", { name: "生图", exact: true }).click();
  await expect(dialog.locator(".chat-image")).toHaveCount(1);
  await expect(dialog.locator(".chat-line.user").first()).not.toContainText(/masterpiece|solo/);
  expect(String(imageBodies[0].prompt)).toContain("masterpiece");
  expect(["1024x1024", "1024x1536", "1536x1024"]).toContain(String(imageBodies[0].size));
  // 聊天中让角色拍照：模型回复里带标记，按它的画面描述出图，标记本身不显示
  await dialog.getByLabel("发送给角色").fill("给我拍张照吧");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog.locator(".chat-image")).toHaveCount(2);
  await expect(dialog).toContainText("好呀，笑一个～");
  await expect(dialog).not.toContainText("[[拍照");
  expect(String(imageBodies[1].prompt)).toContain("smiling, sitting by the window, soft light");
  await expect(dialog.locator(".chat-avatar .avatar").first()).toBeVisible();
});

test("角色聊天联网搜索：角色写搜索标记后应用替它搜索、阅读首条网页，再以角色口吻回答并附来源", async ({ page }) => {
  const asks: any[] = [];
  await page.route("https://ai.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    const system = String(body.messages[0].content);
    if (!system.includes("和玩家轻松聊天"))
      return route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: '["留言一。"]' } }] } });
    asks.push(body.messages);
    const content =
      asks.length === 1 ? "[[搜索: 光之美少女 最新剧场版]]" : "我查到啦，新剧场版明年上映哦！";
    return route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content } }] } });
  });
  let searched = "";
  await page.route("**/__huiqi_web/search", async (route) => {
    searched = route.request().postDataJSON().query;
    await route.fulfill({
      json: {
        success: true,
        provider: "Bing",
        query: searched,
        results: [
          { title: "剧场版官网", url: "https://example.com/movie", snippet: "2027 年上映" },
          { title: "新闻", url: "https://example.com/news", snippet: "公布了海报" },
        ],
      },
    });
  });
  await page.route("**/__huiqi_web/read", (route) =>
    route.fulfill({
      json: { success: true, url: "https://example.com/movie", title: "剧场版官网", text: "定档 2027 年春季。", truncated: false },
    }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("huiqi-birthday-note-auto", "off");
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({ endpoint: "https://ai.example.test/v1", model: "m", key: "k", remember: true, mode: "tools" }),
    );
  });
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.locator(".character-card").filter({ hasText: "露露卡" }).getByRole("button", { name: "和 露露卡 聊天" }).click();
  const dialog = page.getByRole("dialog", { name: /和 露露卡/ });
  await dialog.getByLabel("发送给角色").fill("新剧场版什么时候上映？");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog).toContainText("我查到啦，新剧场版明年上映哦！");
  await expect(dialog).not.toContainText("[[搜索");
  expect(searched).toBe("光之美少女 最新剧场版");
  expect(String(asks[0][0].content)).toContain("[[搜索: 关键词]]");
  const followUp = asks[1].at(-1);
  expect(followUp.role).toBe("user");
  expect(followUp.content).toContain("2027 年上映");
  expect(followUp.content).toContain("定档 2027 年春季");
  await expect(dialog.getByLabel("搜索来源")).toContainText("剧场版官网");
});

test("聊天增强：角色设定与用户称呼带给 AI；开场白；重新生成可切换版本；编辑、删除消息", async ({
  page,
}) => {
  const systems: string[] = [];
  let n = 0;
  await page.route("https://ai.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    const system = String(body.messages[0].content);
    if (!system.includes("和玩家轻松聊天"))
      return route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: '["留言一。"]' } }] } });
    systems.push(system);
    const text = ["回复甲", "回复乙", "回复丙"][n++ % 3];
    return route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: text } }] } });
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("huiqi-birthday-note-auto", "off");
    localStorage.setItem(
      "huiqi-ai-config",
      JSON.stringify({ endpoint: "https://ai.example.test/v1", model: "m", key: "k", remember: true, mode: "tools" }),
    );
  });
  await page.reload();
  // 用户称呼和简介
  await page.locator("nav").getByRole("button", { name: "设置" }).click();
  await page.getByLabel("我的称呼").fill("小夏");
  await page.getByLabel("我的简介").fill("爱画画的大学生");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  // 角色的聊天设定
  await page.locator("nav").getByRole("button", { name: "角色库" }).click();
  await page.locator(".character-card").filter({ hasText: "露露卡" }).locator(".character-cover").click();
  await page.getByText("聊天设定（开场白、性格补充、示例对话）").click();
  await page.getByLabel("开场白").fill("你来啦！等你好久了。");
  await page.getByLabel("性格补充").fill("嘴硬心软");
  await page.getByLabel("示例对话").fill("我：冷\n露露卡：披上");
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await page.getByRole("button", { name: "和 露露卡 聊天" }).click();
  const dialog = page.getByRole("dialog", { name: /和 露露卡/ });
  await expect(dialog).toContainText("你来啦！等你好久了。");
  await dialog.getByLabel("发送给角色").fill("你好");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog).toContainText("回复甲");
  expect(systems[0]).toContain("嘴硬心软");
  expect(systems[0]).toContain("小夏");
  expect(systems[0]).toContain("爱画画的大学生");
  expect(systems[0]).toContain("exampleDialogue");
  // 重新生成：新版本加进去，可以左右切换
  await dialog.getByRole("button", { name: "重新生成这条回复" }).click();
  await expect(dialog).toContainText("回复乙");
  await expect(dialog).toContainText("2 / 2");
  await dialog.getByRole("button", { name: "上一个版本" }).click();
  await expect(dialog).toContainText("回复甲");
  await expect(dialog).toContainText("1 / 2");
  // 编辑最后一条回复
  await dialog.locator(".chat-line.assistant").last().hover();
  await dialog.getByRole("button", { name: "编辑这条消息" }).last().click();
  await dialog.getByLabel("编辑消息").fill("改过的回复");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toContainText("改过的回复");
  // 删除我说的那句
  await dialog.locator(".chat-line.user").hover();
  await dialog.locator(".chat-line.user").getByRole("button", { name: "删除这条消息" }).click();
  await expect(dialog.locator(".chat-line.user")).toHaveCount(0);
  // 重新打开仍是编辑后的内容
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "和 露露卡 聊天" }).click();
  await expect(page.getByRole("dialog", { name: /和 露露卡/ })).toContainText("改过的回复");
});
