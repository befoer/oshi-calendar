import { expect, it, vi } from "vitest";
// @ts-expect-error JS main-process helpers
import * as updates from "../electron/updates.mjs";
const {
  checkForUpdate,
  compareVersions,
  createUpdateChecker,
  UPDATE_MANIFEST,
} = updates;

it("版本号按数字比较", () => {
  expect(compareVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
});

it("通过公开 YAML 清单发现新版，不请求 REST API；下载地址只来自固定仓库", async () => {
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response(
        "version: 1.0.1\npath: https://untrusted.example/installer.exe\n",
      ),
  );
  expect(await checkForUpdate("1.0.0", fetcher)).toMatchObject({
    status: "available",
    latest: "1.0.1",
    url: "https://github.com/befoer/oshi-calendar/releases/download/v1.0.1/oshi-calendar-1.0.1-setup.exe",
  });
  expect(fetcher.mock.calls[0][0]).toBe(UPDATE_MANIFEST);
  expect(UPDATE_MANIFEST).not.toContain("api.github.com");
  expect(await checkForUpdate("1.0.1", fetcher)).toMatchObject({
    status: "latest",
  });
});

it("无发布、网络失败、无效清单和预发布版本都不会显示可安装更新", async () => {
  for (const body of [
    "version: ../evil",
    "version: 1.0.2-beta.1",
    "<html>Not found</html>",
    "version: [broken",
  ]) {
    expect(
      (await checkForUpdate("1.0.0", async () => new Response(body))).status,
    ).toBe("error");
  }
  expect(
    await checkForUpdate(
      "1.0.0",
      async () => new Response("", { status: 404 }),
    ),
  ).toMatchObject({ status: "error" });
  expect(
    await checkForUpdate("1.0.0", async () => {
      throw new TypeError("offline");
    }),
  ).toMatchObject({ status: "error" });
});

it("合并并发检查；一分钟内连续点击不重复请求，之后手动检查可刷新", async () => {
  let now = 1000;
  const check = vi.fn(async () => ({ status: "latest", current: "1.0.1" }));
  const flow = createUpdateChecker(check, { current: "1.0.1", now: () => now });
  await Promise.all([flow.check(), flow.check(), flow.check()]);
  await flow.check();
  expect(check).toHaveBeenCalledTimes(1);
  now += 60_000;
  await flow.check();
  expect(check).toHaveBeenCalledTimes(2);
});

it("启动检查跨重启复用六小时缓存；升级版本与手动检查不被旧缓存挡住", async () => {
  let now = 1000;
  let saved: unknown;
  const check = vi.fn(async () => ({ status: "latest", current: "1.0.1" }));
  const options = {
    current: "1.0.1",
    now: () => now,
    readCache: async () => saved,
    writeCache: async (v: unknown) => {
      saved = v;
    },
  };
  await createUpdateChecker(check, options).check({ automatic: true });
  now += 120_000;
  await createUpdateChecker(check, options).check({ automatic: true });
  expect(check).toHaveBeenCalledTimes(1);
  await createUpdateChecker(check, options).check();
  expect(check).toHaveBeenCalledTimes(2);
  await createUpdateChecker(check, { ...options, current: "1.0.2" }).check({
    automatic: true,
  });
  expect(check).toHaveBeenCalledTimes(3);
  now += 6 * 60 * 60_000;
  await createUpdateChecker(check, options).check({ automatic: true });
  expect(check).toHaveBeenCalledTimes(4);
});

it("失败只退避一分钟；安装版的 available 缓存不能代替重新加载安装元数据", async () => {
  let now = 1000;
  let saved: unknown;
  const check = vi.fn(async () => ({ status: "error", current: "1.0.1" }));
  const options = {
    current: "1.0.1",
    now: () => now,
    readCache: async () => saved,
    writeCache: async (v: unknown) => {
      saved = v;
    },
  };
  await createUpdateChecker(check, options).check();
  now += 30_000;
  await createUpdateChecker(check, options).check({ automatic: true });
  expect(check).toHaveBeenCalledTimes(1);
  now += 30_000;
  await createUpdateChecker(check, options).check({ automatic: true });
  expect(check).toHaveBeenCalledTimes(2);
  const available = vi.fn(async () => ({
    status: "available",
    current: "1.0.1",
    latest: "1.0.2",
  }));
  await createUpdateChecker(available, {
    ...options,
    cacheAvailable: false,
  }).check();
  expect(saved).toBeNull();
  await createUpdateChecker(available, {
    ...options,
    cacheAvailable: false,
  }).check({ automatic: true });
  expect(available).toHaveBeenCalledTimes(2);
});
