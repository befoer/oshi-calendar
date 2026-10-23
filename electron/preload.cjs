// 给推日页面一个很小的桌面接口：当前版本、检查更新、用系统浏览器打开下载链接。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oshiDesktop", {
  version: () => ipcRenderer.invoke("desktop:version"),
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  openDownload: (url) => ipcRenderer.invoke("desktop:open-download", url),
});
