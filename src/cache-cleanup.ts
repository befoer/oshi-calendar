/**
 * 旧版本把 lain.bgm.tv 的跨域图片（opaque 响应）缓存进了 bangumi-portraits，
 * Chrome 按每条约 7–9 MB 计入存储配额，本地存储会显示几百 MB。新版不再缓存，启动时删掉旧缓存。
 */
export const oldCachesCleared: Promise<void> =
  typeof caches === "undefined"
    ? Promise.resolve()
    : caches
        .delete("bangumi-portraits")
        .then(() => undefined)
        .catch(() => undefined);
