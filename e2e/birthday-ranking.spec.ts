import { expect, test } from "@playwright/test";

const character = (id: number, day = 29) => ({
  id,
  favourites: 1000 - id,
  gender: "Female",
  name: { full: `Character ${id}`, native: `寿星 ${id}` },
  image: null,
  dateOfBirth: { year: null, month: 10, day },
  media: {
    nodes: [{ title: { native: "测试作品", english: null, romaji: null } }],
  },
});
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-29T12:00:00+08:00") });
});

test("今日榜显示五位并可刷新，同日重新打开复用缓存，窄屏没有横向溢出", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://graphql.anilist.co/**", (route) => {
    const request = route.request().postDataJSON();
    if (request.variables?.birthday) {
      calls++;
      return route.fulfill({
        json: {
          data: {
            Page: {
              pageInfo: { hasNextPage: false },
              characters: [1, 2, 3, 4, 5].map((id) => character(id)),
            },
          },
        },
      });
    }
    return route.fulfill({
      json: {
        data: { Page: { characters: [], pageInfo: { hasNextPage: false } } },
      },
    });
  });
  await page.goto("/");
  const ranking = page.getByRole("region", { name: "今日人气寿星" });
  await expect(ranking.getByRole("link")).toHaveCount(5);
  await expect(ranking).toContainText("按 AniList 人气排序");
  await expect(ranking).not.toContainText("收藏人数");
  await expect(ranking.getByRole("link").first()).toHaveAttribute(
    "href",
    "https://anilist.co/character/1",
  );
  await expect(ranking.getByRole("link").filter({ hasText: /人收藏/ })).toHaveCount(0);
  await ranking.getByRole("button", { name: "刷新排名" }).click();
  await expect(ranking.getByRole("link")).toHaveCount(5);
  const before = calls;
  await page.reload();
  await expect(ranking.getByRole("link")).toHaveCount(5);
  expect(calls).toBe(before);
  await page.screenshot({
    path: "test-results/birthday-ranking-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await ranking.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/birthday-ranking-mobile.png",
    fullPage: true,
  });
});

test("源日期不一致时显示提示，重试后恢复，跨过北京时间零点自动更新", async ({
  page,
}) => {
  let day = 28;
  await page.route("https://graphql.anilist.co/**", (route) =>
    route.fulfill({
      json: {
        data: {
          Page: {
            characters: [character(1, day)],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    }),
  );
  await page.goto("/");
  const ranking = page.getByRole("region", { name: "今日人气寿星" });
  await expect(ranking).toContainText("尚未与北京时间今天同步");
  await expect(ranking.getByRole("link")).toHaveCount(0);
  day = 29;
  await ranking.getByRole("button", { name: "刷新排名" }).click();
  await expect(ranking.getByRole("link")).toHaveCount(1);
  day = 30;
  await page.clock.fastForward("12:01:00");
  await expect(ranking).toContainText("10 月 30 日");
  await expect(ranking.getByRole("link")).toHaveCount(1);
  await expect(ranking).not.toContainText("尚未与北京时间今天同步");
});

test("默认女角色，更多按人气展开，性别与板块顺序在刷新后保留", async ({
  page,
}) => {
  let calls = 0;
  const entries = Array.from({ length: 16 }, (_, i) => ({
    ...character(i + 1),
    gender: i % 2 ? "Male" : "Female",
  }));
  await page.route("https://graphql.anilist.co/**", (route) => {
    if (route.request().postDataJSON().variables?.birthday) calls++;
    return route.fulfill({
      json: {
        data: {
          Page: { characters: entries, pageInfo: { hasNextPage: false } },
        },
      },
    });
  });
  await page.goto("/");
  const ranking = page.getByRole("region", { name: "今日人气寿星" });
  await expect(
    ranking.getByRole("button", { name: "女角色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(ranking.getByRole("link")).toHaveCount(5);
  await expect(ranking.getByRole("link").nth(4)).toHaveAttribute(
    "href",
    "https://anilist.co/character/9",
  );
  await ranking.getByRole("button", { name: /显示更多/ }).click();
  await expect(ranking.getByRole("link")).toHaveCount(8);
  await ranking.getByRole("button", { name: /收起/ }).click();
  await expect(ranking.getByRole("link")).toHaveCount(5);
  await ranking.getByRole("button", { name: "男角色", exact: true }).click();
  await expect(ranking.getByRole("link").first()).toHaveAttribute(
    "href",
    "https://anilist.co/character/2",
  );
  await ranking.getByRole("button", { name: "移到近期角色生日下方" }).click();
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector(".birthday-section")!
          .compareDocumentPosition(
            document.querySelector(".birthday-ranking")!,
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    ranking.getByRole("button", { name: "男角色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    ranking.getByRole("button", { name: "移到近期角色生日上方" }),
  ).toBeVisible();
  await ranking.getByRole("button", { name: "全部", exact: true }).click();
  await expect(ranking.getByRole("link")).toHaveCount(5);
  await ranking.getByRole("button", { name: /显示更多/ }).click();
  await expect(ranking.getByRole("link")).toHaveCount(10);
  await ranking.getByRole("button", { name: "移到近期角色生日上方" }).click();
  await expect(ranking.getByRole("link")).toHaveCount(10);
  await page.screenshot({
    path: "test-results/ranking-filters-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await ranking.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/ranking-filters-mobile.png",
    fullPage: true,
  });
  expect(calls).toBeLessThanOrEqual(2);
});
