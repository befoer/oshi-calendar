import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
// @ts-expect-error JS main-process helper
import { createInstalledUpdates } from "../electron/installed-updates.mjs";

class Updater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkForUpdates = vi.fn(async () => {
    this.emit("update-available", { version: "1.0.1" });
  });
  downloadUpdate = vi.fn(async () => {
    this.emit("download-progress", { percent: 48.7 });
    this.emit("update-downloaded", { version: "1.0.1" });
  });
  quitAndInstall = vi.fn();
}
it("下载完成才能安装；并发请求合并，保留进度", async () => {
  const updater = new Updater();
  const publish = vi.fn();
  const flow = createInstalledUpdates(updater, "1.0.0", publish);
  expect(flow.install()).toBe(false);
  await flow.download();
  expect(updater.downloadUpdate).not.toHaveBeenCalled();
  await Promise.all([flow.check(), flow.check()]);
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  await Promise.all([flow.download(), flow.download()]);
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({ status: "downloading", percent: 48 }),
  );
  expect(flow.snapshot()).toMatchObject({ status: "ready", latest: "1.0.1" });
  await flow.check();
  expect(flow.snapshot().status).toBe("ready");
  expect(flow.install()).toBe(true);
  expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
});
it("下载失败可重试，不会误安装", async () => {
  const updater = new Updater();
  updater.downloadUpdate.mockRejectedValueOnce(new Error("offline"));
  const flow = createInstalledUpdates(updater, "1.0.0");
  await flow.check();
  await flow.download();
  expect(flow.snapshot().status).toBe("error");
  expect(flow.install()).toBe(false);
  await flow.check();
  await flow.download();
  expect(flow.snapshot().status).toBe("ready");
});
