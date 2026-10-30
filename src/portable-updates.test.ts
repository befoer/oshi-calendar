import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error JS main process module
import * as portable from "../electron/portable-updates.mjs";
const {
  parsePortableManifest,
  downloadPortableFile,
  createPortableUpdates,
  PORTABLE_MANIFEST,
} = portable;

const bytes = Buffer.from("MZ-test-portable-binary");
const manifest = {
  version: "1.0.1",
  file: "oshi-calendar-1.0.1-portable.exe",
  size: bytes.length,
  sha512: createHash("sha512").update(bytes).digest("base64"),
};
const folders: string[] = [];
async function temp() {
  const folder = await mkdtemp(join(tmpdir(), "oshi-portable-"));
  folders.push(folder);
  return folder;
}
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

it("清单只允许稳定版和固定仓库的便携 EXE", () => {
  expect(parsePortableManifest(manifest).url).toBe(
    "https://github.com/befoer/oshi-calendar/releases/download/v1.0.1/oshi-calendar-1.0.1-portable.exe",
  );
  for (const patch of [
    { version: "1.0.2-beta" },
    { file: "../setup.exe" },
    { size: -1 },
    { sha512: "bad" },
  ])
    expect(() => parsePortableManifest({ ...manifest, ...patch })).toThrow();
});

it("流式保存校验通过的 EXE，校验失败和大小超限清除不完整文件", async () => {
  const folder = await temp();
  const file = join(folder, "new.exe");
  await downloadPortableFile(new Response(bytes), file, manifest);
  expect(await readFile(file)).toEqual(bytes);
  await rm(file);
  await expect(
    downloadPortableFile(
      new Response(Buffer.alloc(bytes.length, 1)),
      file,
      manifest,
    ),
  ).rejects.toThrow("校验失败");
  await expect(readFile(file)).rejects.toThrow();
  await expect(
    downloadPortableFile(
      new Response(Buffer.alloc(bytes.length + 1)),
      file,
      manifest,
    ),
  ).rejects.toThrow("大小不匹配");
  await expect(readFile(file)).rejects.toThrow();
});

it("检查与下载合并并发请求，只下载便携版，未确认重启前不修改旧 EXE", async () => {
  const folder = await temp();
  const target = join(folder, "我的推日.exe");
  const helper = join(folder, "helper.exe");
  await writeFile(target, "old app");
  await writeFile(helper, "helper");
  const fetcher = vi.fn(async (url: string) =>
    url === PORTABLE_MANIFEST
      ? new Response(JSON.stringify(manifest))
      : new Response(bytes),
  );
  const quit = vi.fn();
  const flow = createPortableUpdates({
    current: "1.0.0",
    target,
    helper,
    fetchImpl: fetcher,
    quit,
  });
  expect(await flow.install()).toBe(false);
  await Promise.all([flow.check(), flow.check()]);
  expect(flow.snapshot()).toMatchObject({
    status: "available",
    automatic: true,
    latest: "1.0.1",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await Promise.all([flow.download(), flow.download()]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toContain("-portable.exe");
  expect(flow.snapshot()).toMatchObject({ status: "ready", percent: 100 });
  expect(await readFile(target, "utf8")).toBe("old app");
  expect(quit).not.toHaveBeenCalled();
  await flow.check();
  expect(flow.snapshot().status).toBe("ready");
});

it("下载校验失败不允许安装，重新检查后可重试", async () => {
  const folder = await temp();
  const helper = join(folder, "helper.exe");
  await writeFile(helper, "helper");
  let bad = true;
  const flow = createPortableUpdates({
    current: "1.0.0",
    target: join(folder, "app.exe"),
    helper,
    fetchImpl: async (url: string) =>
      url === PORTABLE_MANIFEST
        ? new Response(JSON.stringify(manifest))
        : new Response(bad ? Buffer.from("bad") : bytes),
    quit: vi.fn(),
  });
  await flow.check();
  await flow.download();
  expect(flow.snapshot().status).toBe("error");
  expect(await flow.install()).toBe(false);
  bad = false;
  await flow.check();
  await flow.download();
  expect(flow.snapshot().status).toBe("ready");
});
