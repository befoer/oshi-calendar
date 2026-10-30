import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, copyFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { compareVersions, RELEASES_PAGE } from "./updates.mjs";

export const PORTABLE_MANIFEST = `${RELEASES_PAGE}/latest/download/portable-update.json`;
export function parsePortableManifest(value) {
  if (
    !value ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    value.file !== `oshi-calendar-${value.version}-portable.exe` ||
    !Number.isSafeInteger(value.size) ||
    value.size < 2 ||
    value.size > 2_000_000_000 ||
    typeof value.sha512 !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(value.sha512)
  )
    throw new Error("便携版更新清单无效");
  return {
    ...value,
    url: `${RELEASES_PAGE}/download/v${value.version}/${value.file}`,
  };
}

export async function downloadPortableFile(
  response,
  file,
  manifest,
  progress = () => {},
) {
  if (!response.ok || !response.body)
    throw new Error(`下载失败 HTTP ${response.status}`);
  const hash = createHash("sha512");
  let size = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > manifest.size)
            return callback(new Error("更新文件大小不匹配"));
          hash.update(chunk);
          progress(Math.min(99, Math.floor((size / manifest.size) * 100)));
          callback(null, chunk);
        },
      }),
      createWriteStream(file, { flags: "wx" }),
    );
    if (size !== manifest.size || hash.digest("base64") !== manifest.sha512)
      throw new Error("更新文件校验失败，请重新下载");
    const { open } = await import("node:fs/promises");
    const handle = await open(file, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
}

export function createPortableUpdates({
  current,
  target,
  helper,
  fetchImpl,
  quit,
  publish = () => {},
}) {
  let state = { status: "idle", current, automatic: true };
  let manifest,
    pending,
    downloading,
    installing = false,
    folder;
  const set = (patch) => {
    state = { ...state, ...patch };
    publish(state);
    return state;
  };
  const fail = (error) =>
    set({
      status: "error",
      message: error instanceof Error ? error.message : "便携版更新失败",
    });
  return {
    snapshot: () => state,
    check() {
      if (["downloading", "ready"].includes(state.status))
        return Promise.resolve(state);
      if (pending) return pending;
      pending = (async () => {
        set({ status: "checking", message: undefined });
        try {
          const response = await fetchImpl(PORTABLE_MANIFEST, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok)
            throw new Error(`更新检查失败 HTTP ${response.status}`);
          const text = await response.text();
          if (text.length > 16_384) throw new Error("便携版更新清单过大");
          manifest = parsePortableManifest(JSON.parse(text));
          return set({
            status:
              compareVersions(manifest.version, current) > 0
                ? "available"
                : "latest",
            latest: manifest.version,
          });
        } catch (error) {
          return fail(error);
        }
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    download() {
      if (downloading) return downloading;
      if (state.status !== "available" || !manifest)
        return Promise.resolve(state);
      const selected = manifest;
      set({ status: "downloading", percent: 0 });
      downloading = (async () => {
        try {
          folder = join(dirname(target), `.oshi-update-${randomUUID()}`);
          await mkdir(folder);
          const response = await fetchImpl(selected.url, {
            signal: AbortSignal.timeout(30 * 60_000),
          });
          await downloadPortableFile(
            response,
            join(folder, "new.exe"),
            selected,
            (percent) => {
              if (state.percent !== percent)
                set({ status: "downloading", percent });
            },
          );
          await copyFile(helper, join(folder, "updater.exe"));
          return set({ status: "ready", percent: 100 });
        } catch (error) {
          return fail(error);
        }
      })().finally(() => {
        downloading = undefined;
      });
      return downloading;
    },
    async install() {
      if (state.status !== "ready" || installing) return false;
      installing = true;
      try {
        const child = spawn(
          join(folder, "updater.exe"),
          [String(process.pid), resolve(target), manifest.sha512],
          {
            detached: true,
            windowsHide: true,
            stdio: "ignore",
          },
        );
        await new Promise((ok, reject) => {
          child.once("spawn", ok);
          child.once("error", reject);
        });
        child.unref();
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (
            (await readFile(join(folder, "helper-ready"), "utf8").catch(
              () => "",
            )) === "ready"
          ) {
            quit();
            return true;
          }
          await new Promise((ok) => setTimeout(ok, 100));
        }
        throw new Error("更新助手未能启动，程序尚未退出，请重试");
      } catch (error) {
        fail(error);
        installing = false;
        return false;
      }
    },
  };
}
