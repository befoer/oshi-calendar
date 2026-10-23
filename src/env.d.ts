/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare const __APP_BUILD__: string;
declare module "lunar-javascript" {
  export const Solar: any;
  export const Lunar: any;
}
/** Electron 桌面版的 preload 提供；浏览器版没有 */
interface Window {
  oshiDesktop?: {
    version: () => Promise<string>;
    checkUpdate: () => Promise<{
      status: "latest" | "available" | "error";
      current: string;
      latest?: string;
      url?: string;
      notes?: string;
      message?: string;
    }>;
    openDownload: (url: string) => Promise<void>;
  };
}
