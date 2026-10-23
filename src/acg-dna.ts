import type { Character } from "./domain";
import { isRemoteAvatar, localizeAvatar } from "./avatars";

/**
 * 与「次元属性」(acg-dna-web) 联动：打开它的网页（带 ?import=oshi-calendar），
 * 等它发来 ready 后，用 postMessage 把角色的名字、作品和头像（data URL）直接交给它。
 * 数据只在两个浏览器页面之间传递，不经过任何服务器；对方会先弹确认框再导入。
 */
export const ACG_DNA_URL = "https://befoer.github.io/acg-dna-web/";
const READY = "acg-dna:ready";
const IMPORTED = "acg-dna:imported";
const CHARACTERS = "oshi-calendar:characters";
const VERSION = 1;
const WAIT_READY_MS = 60_000;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|avif);base64,/;

/** 开发时可在 localStorage 里设置 huiqi-acg-dna-url 指向本地的次元属性。 */
export function acgDnaURL() {
  try {
    const custom = localStorage.getItem("huiqi-acg-dna-url");
    if (custom && /^https?:\/\//.test(custom)) return custom;
  } catch {
    /* 隐私模式等读不到时用正式地址 */
  }
  return ACG_DNA_URL;
}

async function avatarData(c: Character): Promise<string | undefined> {
  if (IMAGE_DATA_URL.test(c.avatarUrl)) return c.avatarUrl;
  if (!isRemoteAvatar(c.avatarUrl)) return undefined;
  try {
    const local = await localizeAvatar(c.avatarUrl);
    return IMAGE_DATA_URL.test(local) ? local : undefined;
  } catch {
    return undefined;
  }
}

export async function acgDnaPayload(characters: Character[]) {
  return {
    type: CHARACTERS,
    version: VERSION,
    characters: await Promise.all(
      characters.map(async (c) => {
        const image = await avatarData(c);
        return {
          name: c.name,
          works: c.works.slice(0, 6),
          ...(image ? { image } : {}),
        };
      }),
    ),
  };
}

export type AcgDnaProgress = "opening" | "sent" | "imported";

/**
 * 必须在点击事件里同步调用（window.open 才不会被拦截）。
 * 对方导入完成时 resolve 导入数量；窗口被关掉或一分钟内没响应时 reject。
 */
export function sendToAcgDna(
  characters: Character[],
  onProgress?: (step: AcgDnaProgress) => void,
): Promise<number> {
  const base = acgDnaURL();
  const target = new URL(base);
  target.searchParams.set("import", "oshi-calendar");
  const popup = window.open(target.href, "acg-dna-web");
  if (!popup)
    return Promise.reject(
      new Error("浏览器拦截了弹出窗口，请允许本页打开新窗口后再试"),
    );
  onProgress?.("opening");
  const payload = acgDnaPayload(characters);
  return new Promise<number>((resolve, reject) => {
    let sent = false;
    const finish = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      clearInterval(closed);
    };
    const timer = setTimeout(() => {
      if (sent) return;
      finish();
      reject(new Error("次元属性没有响应，请确认网页已打开后再试"));
    }, WAIT_READY_MS);
    const closed = setInterval(() => {
      if (!popup.closed) return;
      finish();
      reject(
        new Error(sent ? "次元属性窗口已关闭，未确认导入" : "次元属性窗口已关闭"),
      );
    }, 1000);
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== popup || event.origin !== target.origin) return;
      const data = event.data as { type?: string; count?: number } | null;
      if (data?.type === READY && !sent) {
        sent = true;
        popup.postMessage(await payload, target.origin);
        onProgress?.("sent");
      } else if (data?.type === IMPORTED) {
        finish();
        onProgress?.("imported");
        resolve(typeof data.count === "number" ? data.count : 0);
      }
    };
    window.addEventListener("message", onMessage);
  });
}
