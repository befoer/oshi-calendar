import { expect, it } from "vitest";
// @ts-expect-error 纯 JS 模块，没有类型声明
import { checkForUpdate, compareVersions, pickDownload } from "../electron/updates.mjs";

it("版本号比较：按数字逐段比，忽略前缀 v", () => {
  expect(compareVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0", "1.1")).toBeLessThan(0);
});

it("检查更新：有新版返回文件夹版 zip 下载地址；没新版、草稿、404、断网各有结果", async () => {
  const reply = (body: unknown, status = 200) => async () =>
    new Response(JSON.stringify(body), { status });
  const release = {
    tag_name: "v1.1.0",
    html_url: "https://github.com/befoer/oshi-calendar/releases/tag/v1.1.0",
    body: "新增双向联动",
    assets: [
      { name: "推日-1.1.0-便携版.exe", browser_download_url: "https://github.com/x/portable.exe" },
      { name: "推日-1.1.0-文件夹版.zip", browser_download_url: "https://github.com/x/folder.zip" },
    ],
  };
  expect(await checkForUpdate("1.0.0", reply(release))).toMatchObject({
    status: "available",
    latest: "1.1.0",
    url: "https://github.com/x/folder.zip",
    notes: "新增双向联动",
  });
  expect((await checkForUpdate("1.1.0", reply(release))).status).toBe("latest");
  expect((await checkForUpdate("1.0.0", reply({ ...release, prerelease: true }))).status).toBe("latest");
  expect(await checkForUpdate("1.0.0", reply({}, 404))).toMatchObject({ status: "error" });
  expect(
    await checkForUpdate("1.0.0", async () => {
      throw new TypeError("fetch failed");
    }),
  ).toMatchObject({ status: "error", message: expect.stringContaining("无法连接 GitHub") });
  expect(pickDownload({ html_url: "https://github.com/p", assets: [] })).toBe("https://github.com/p");
  expect(pickDownload({ ...release, assets: [...release.assets, {
    name: "oshi-calendar-1.1.0-setup.exe", browser_download_url: "https://github.com/x/setup.exe",
  }] })).toBe("https://github.com/x/setup.exe");
});
