// 仅暴露版本和更新操作；下载源与安装文件由主进程管理。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oshiDesktop", {
  version: () => ipcRenderer.invoke("desktop:version"),
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  updateState: () => ipcRenderer.invoke("desktop:update-state"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:update-state", listener);
    return () => ipcRenderer.removeListener("desktop:update-state", listener);
  },
  openDownload: (url) => ipcRenderer.invoke("desktop:open-download", url),
});
