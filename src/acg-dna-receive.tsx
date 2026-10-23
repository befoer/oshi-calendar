import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { newCharacter, type Character, type Data } from "./domain";
import { repository } from "./store";
import { syncBirthdays } from "./bangumi";
import { quietNetwork } from "./external-network";
import { Modal } from "./ui";

/**
 * 反向联动：次元属性用 window.open 打开推日（带 ?import=acg-dna），
 * 推日准备好后发 ready，次元属性再把角色（名字、头像、Bangumi 角色 ID）发过来。
 * 只接受次元属性的地址、且必须来自打开本页的那个窗口。
 */
export const ACG_ORIGINS = [
  "https://befoer.github.io",
  // 本地开发次元属性时
  "http://127.0.0.1:5260",
  "http://localhost:5260",
];
const READY = "oshi-calendar:ready";
const IMPORTED = "oshi-calendar:imported";
const CHARACTERS = "acg-dna:characters";
const VERSION = 1;
const MAX = 50;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
const BANGUMI_IMAGE = /^https:\/\/lain\.bgm\.tv\/[^\s"'<>]+$/;

export type IncomingCharacter = {
  name: string;
  avatarUrl: string;
  bangumiId: number | null;
};

const clean = (value: unknown, max: number) =>
  typeof value === "string"
    ? [...value]
        .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
        .join("")
        .trim()
        .slice(0, max)
    : "";

/** 校验次元属性发来的消息；格式不对返回 null。空名丢弃，重名只保留第一个，最多 50 个。 */
export function parseAcgMessage(data: unknown): IncomingCharacter[] | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (
    record.type !== CHARACTERS ||
    record.version !== VERSION ||
    !Array.isArray(record.characters)
  )
    return null;
  const seen = new Set<string>();
  const list: IncomingCharacter[] = [];
  for (const item of record.characters) {
    if (list.length >= MAX) break;
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const name = clean(entry.name, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const image =
      typeof entry.image === "string" &&
      entry.image.length < 20_000_000 &&
      IMAGE_DATA_URL.test(entry.image)
        ? entry.image
        : typeof entry.imageUrl === "string" && BANGUMI_IMAGE.test(entry.imageUrl)
          ? entry.imageUrl
          : "";
    const id = Number(entry.bangumiId);
    list.push({
      name,
      avatarUrl: image,
      bangumiId: Number.isInteger(id) && id > 0 ? id : null,
    });
  }
  return list;
}

/** 已有同一个 Bangumi 角色或同名角色时视为已存在。 */
export function findExisting(incoming: IncomingCharacter, characters: Character[]) {
  return characters.find(
    (c) =>
      (incoming.bangumiId !== null && c.bangumiId === incoming.bangumiId) ||
      c.name === incoming.name ||
      c.aliases.includes(incoming.name),
  );
}

export function toCharacter(incoming: IncomingCharacter): Character {
  return {
    ...newCharacter(incoming.name),
    avatarUrl: incoming.avatarUrl,
    bangumiId: incoming.bangumiId,
  };
}

/** 页面带 ?import=acg-dna 且由次元属性打开时，向它要角色；收到后返回待确认列表。 */
export function useAcgDnaReceive(ready: boolean) {
  const [incoming, setIncoming] = useState<IncomingCharacter[] | null>(null);
  const opener = useRef<{ window: Window; origin: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("import") !== "acg-dna" || !window.opener) return;
    const source = window.opener as Window;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== source || !ACG_ORIGINS.includes(event.origin)) return;
      const parsed = parseAcgMessage(event.data);
      if (!parsed) return;
      opener.current = { window: source, origin: event.origin };
      setIncoming(parsed);
      url.searchParams.delete("import");
      window.history.replaceState(window.history.state, "", url.href);
    };
    window.addEventListener("message", onMessage);
    for (const origin of ACG_ORIGINS)
      try {
        source.postMessage({ type: READY, version: VERSION }, origin);
      } catch {
        /* 打开者已关闭 */
      }
    return () => window.removeEventListener("message", onMessage);
  }, [ready]);
  const reply = (count: number) => {
    const target = opener.current;
    if (target && !target.window.closed)
      target.window.postMessage({ type: IMPORTED, version: VERSION, count }, target.origin);
  };
  return { incoming, close: () => setIncoming(null), reply };
}

export function AcgImportDialog({
  incoming,
  data,
  onClose,
  onDone,
}: {
  incoming: IncomingCharacter[];
  data: Data;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fresh = incoming.filter((c) => !findExisting(c, data.characters));
  const confirm = async () => {
    if (!fresh.length) return;
    setSaving(true);
    setError("");
    try {
      await repository.apply(
        fresh.map((c) => ({
          collection: "characters" as const,
          action: "put" as const,
          record: toCharacter(c),
        })),
        `从次元属性导入 ${fresh.length} 个角色`,
      );
      // 带 Bangumi 编号的角色在后台补生日、作品和头像；连不上也不打扰
      if (fresh.some((c) => c.bangumiId) && navigator.onLine)
        void quietNetwork(() => syncBirthdays(true)).catch(() => {});
      onDone(fresh.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
      setSaving(false);
    }
  };
  return (
    <Modal title="从次元属性导入角色" onClose={() => !saving && onClose()}>
      <div className="modal-body">
        <ul className="acg-import-list" aria-label="待导入角色">
          {incoming.map((c) => {
            const existing = findExisting(c, data.characters);
            return (
              <li key={c.name} className={existing ? "skipped" : ""}>
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="acg-import-avatar">{c.name.slice(0, 1)}</span>
                )}
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {existing
                      ? `已在角色库（${existing.name}），跳过`
                      : c.bangumiId
                        ? "已关联 Bangumi，导入后自动补全资料"
                        : "导入后可在角色资料里关联补全"}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="muted">
          将导入 {fresh.length} 个角色
          {incoming.length > fresh.length
            ? `，${incoming.length - fresh.length} 个已存在跳过`
            : ""}
          。
        </p>
        {error && <p className="error">{error}</p>}
      </div>
      <footer>
        <button onClick={onClose} disabled={saving}>
          取消
        </button>
        <button
          className="primary"
          disabled={saving || !fresh.length}
          onClick={() => void confirm()}
        >
          {saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
          确认导入
        </button>
      </footer>
    </Modal>
  );
}
