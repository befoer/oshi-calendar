export function createInstalledUpdates(updater, current, publish = () => {}) {
  let state = { status: "idle", current, automatic: true };
  let checkPromise;
  let downloadPromise;
  const set = (patch) => {
    state = { ...state, ...patch };
    publish(state);
    return state;
  };
  const fail = () =>
    set({
      status: "error",
      message: "更新失败，请检查网络、代理或 GitHub 正式版本附件后重试",
    });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on("checking-for-update", () =>
    set({ status: "checking", message: undefined }),
  );
  updater.on("update-available", (info) =>
    set({ status: "available", latest: info.version }),
  );
  updater.on("update-not-available", () => set({ status: "latest" }));
  updater.on("download-progress", (info) =>
    set({ status: "downloading", percent: Math.floor(info.percent) }),
  );
  updater.on("update-downloaded", (info) =>
    set({ status: "ready", latest: info.version, percent: 100 }),
  );
  updater.on("error", fail);
  return {
    snapshot: () => state,
    check() {
      if (["downloading", "ready"].includes(state.status))
        return Promise.resolve(state);
      if (!checkPromise)
        checkPromise = (async () => {
          try {
            await updater.checkForUpdates();
          } catch {
            fail();
          } finally {
            checkPromise = undefined;
          }
          return state;
        })();
      return checkPromise;
    },
    download() {
      if (downloadPromise) return downloadPromise;
      if (state.status !== "available") return Promise.resolve(state);
      set({ status: "downloading", percent: 0 });
      downloadPromise = (async () => {
        try {
          await updater.downloadUpdate();
        } catch {
          fail();
        } finally {
          downloadPromise = undefined;
        }
        return state;
      })();
      return downloadPromise;
    },
    install() {
      if (state.status !== "ready") return false;
      updater.quitAndInstall(false, true);
      return true;
    },
  };
}
