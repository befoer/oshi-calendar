import type { Character } from "./domain";
import { avatarFallbackURL } from "./external-network";
import { bangumiImageGatewayURL } from "./bangumi-gateway";
import { getBangumiConnection } from "./bangumi-connection";
import { patchCharacter } from "./store";

/**
 * 角色头像保存到本机：把远程图片下载、缩小后以 data URL 写进 IndexedDB，
 * 之后离线、换网络、站点下线都不影响显示，并随 JSON 备份一起导出。
 */
const MAX_WIDTH = 480;
export const isRemoteAvatar = (url: string) => /^https?:\/\//i.test(url);

async function download(url: string): Promise<Blob> {
  const fallback = avatarFallbackURL(url);
  const gateway = bangumiImageGatewayURL(url);
  // Bangumi 先走图片网关，本机服务与原图地址继续作为回退。
  const sources =
    getBangumiConnection() === "direct" &&
    /^https?:\/\/lain\.bgm\.tv\//i.test(url)
      ? [url, fallback]
      : [gateway, fallback, url];
  const attempts = sources.filter((source): source is string =>
    Boolean(source),
  );
  let failure = "图片下载失败";
  for (const source of attempts) {
    try {
      const response = await fetch(source, {
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        failure = `头像来源返回 HTTP ${response.status}`;
        continue;
      }
      const blob = await response.blob();
      if (/^image\/(png|jpeg|webp|gif)/i.test(blob.type)) return blob;
      failure = "头像来源未返回支持的图片";
    } catch (error) {
      failure = error instanceof Error ? error.message : failure;
    }
  }
  throw new Error(failure);
}
const readAsDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
async function shrink(blob: Blob): Promise<string> {
  // GIF 可能是动图，原样保存；其他格式缩小到 480px 宽再存为 WebP
  if (blob.type === "image/gif") return readAsDataURL(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/webp", 0.9);
    if (!/^data:image\/(webp|png|jpeg);base64,/.test(url))
      throw new Error("浏览器无法转换头像");
    return url;
  } finally {
    bitmap.close();
  }
}
export async function localizeAvatar(url: string) {
  return shrink(await download(url));
}

export type LocalizeResult = { saved: number; failed: number; errors: string[] };
/** 依次把远程头像保存到本机；单张失败不影响其他，返回统计。 */
export async function localizeAvatars(
  characters: Character[],
  onProgress?: (done: number, total: number) => void,
  skip: Set<string> = new Set(),
): Promise<LocalizeResult> {
  const pending = characters.filter(
    (c) => isRemoteAvatar(c.avatarUrl) && !skip.has(c.id + c.avatarUrl),
  );
  const result: LocalizeResult = { saved: 0, failed: 0, errors: [] };
  let done = 0;
  for (const character of pending) {
    try {
      const local = await localizeAvatar(character.avatarUrl);
      await patchCharacter(character.id, { avatarUrl: local }, character.avatarUrl);
      result.saved++;
    } catch (error) {
      skip.add(character.id + character.avatarUrl);
      result.failed++;
      result.errors.push(
        `${character.name}：${error instanceof Error ? error.message : "失败"}`,
      );
    }
    onProgress?.(++done, pending.length);
  }
  return result;
}
