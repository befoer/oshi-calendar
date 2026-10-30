import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("打包主进程加载安装版更新器，用户资料位于固定用户目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "oshi-desktop-smoke-"));
  await writeFile(join(root, "Uninstall 推日.exe"), "");
  const desktop = await _electron.launch({
    args: [resolve("e2e/fixtures/desktop-smoke.mjs")],
    env: { ...process.env, OSHI_SMOKE_ROOT: root, PORTABLE_EXECUTABLE_DIR: "" },
  });
  try {
    const window = await desktop.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await expect.poll(() => window.evaluate(() => window.oshiDesktop?.updateState())).toMatchObject({ automatic: true, status: "idle" });
    expect(await desktop.evaluate(({ app }) => app.getPath("userData"))).toBe(join(root, "OshiCalendar"));
    const state = await window.evaluate(() => window.oshiDesktop!.downloadUpdate());
    expect(state.status).toBe("idle");
  } finally {
    await desktop.close();
    await rm(root, { recursive: true, force: true });
  }
});
