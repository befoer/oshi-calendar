import { useCallback, useEffect, useRef, useState } from "react";
import {
  aiConfigured,
  generateBirthdayPack,
  loadConfig,
  validBirthdayNote,
  type NoteKind,
} from "./ai";
import { daysToBirthday } from "./character-sort";
import type { Character } from "./domain";

/**
 * 首页「下一位寿星」的留言：先让 AI 以角色口吻一次写好几条，存在本机浏览器里；
 * 打开页面时直接从存好的留言里取一条没看过的，不用等 AI；
 * 剩下的没看过的少了，就在页面空闲时悄悄补一批。
 */
const POOL_KEY = "huiqi-birthday-pool";
const AUTO_KEY = "huiqi-birthday-note-auto";
/** 一次让 AI 写几条 */
export const BATCH = 5;
/** 没看过的留言少于这个数就补货 */
export const REFILL_BELOW = 2;
const MAX_PER_KIND = 12;
const MAX_POOLS = 8;
/** 补货失败后，这段时间内不再自动重试 */
const RETRY_AFTER = 10 * 60 * 1000;

export type Item = { t: string; n: number };
export type Pool = {
  name: string;
  today: Item[];
  soon: Item[];
  at: number;
  /** 生成留言时顺便写好的聊天快捷回复（只有触发过留言生成的角色才有） */
  replies?: string[];
};
const MAX_REPLIES = 18;
const REPLIES_WANTED = 6;
type Store = Record<string, Pool>;

/** 是否自动预先生成角色留言（默认开启；关闭后只在点「收取留言」时才请求 AI）。 */
export const noteAutoEnabled = () => {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
};
export const setNoteAuto = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    /* 只是偏好 */
  }
  window.dispatchEvent(new Event("huiqi-ai-config-changed"));
};

// ---------------------------------------------------------------- 存好的留言（纯函数）
export const noteKind = (daysAway: number): NoteKind =>
  daysAway <= 0 ? "today" : "soon";

/** 取被展示次数最少的一条（并列时随机）；尽量不重复 exclude。 */
export function pickNote(
  pool: Pool | undefined,
  kind: NoteKind,
  exclude?: string,
  random = Math.random,
): Item | undefined {
  const items = (pool?.[kind] ?? []).filter((item) =>
    validBirthdayNote(item.t),
  );
  const others = items.filter((item) => item.t !== exclude);
  const list = others.length ? others : items;
  if (!list.length) return undefined;
  const least = Math.min(...list.map((item) => item.n));
  const ties = list.filter((item) => item.n === least);
  return ties[Math.floor(random() * ties.length)];
}

export const unseenCount = (pool: Pool | undefined, kind: NoteKind) =>
  (pool?.[kind] ?? []).filter(
    (item) => item.n === 0 && validBirthdayNote(item.t),
  ).length;

/** 把新写好的留言并进去：去重，超过上限时丢掉看得最多的；角色改名后旧留言作废。 */
export function addToPool(
  pool: Pool | undefined,
  name: string,
  kind: NoteKind,
  texts: string[],
  now = Date.now(),
): Pool {
  const base: Pool =
    pool && pool.name === name ? pool : { name, today: [], soon: [], at: now };
  const have = new Set(base[kind].map((item) => item.t));
  const merged = [
    ...base[kind].filter((item) => validBirthdayNote(item.t)),
    ...texts
      .filter((t) => validBirthdayNote(t) && !have.has(t))
      .map((t) => ({ t, n: 0 })),
  ];
  // 先丢看得最多的；一样多时先丢更早存进来的
  const order = new Map(merged.map((item, i) => [item, i]));
  const keep = new Set(
    [...merged]
      .sort((a, b) => a.n - b.n || order.get(b)! - order.get(a)!)
      .slice(0, MAX_PER_KIND),
  );
  return { ...base, [kind]: merged.filter((item) => keep.has(item)), at: now };
}

const readStore = (): Store => {
  try {
    const parsed = JSON.parse(localStorage.getItem(POOL_KEY) || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
};
const writeStore = (store: Store) => {
  try {
    const ids = Object.keys(store).sort((a, b) => store[b].at - store[a].at);
    for (const id of ids.slice(MAX_POOLS)) delete store[id];
    localStorage.setItem(POOL_KEY, JSON.stringify(store));
  } catch {
    /* 留言只是缓存，写不进去也不影响使用 */
  }
};

type Who = Pick<Character, "id" | "name" | "works">;
const poolOf = (c: Pick<Character, "id" | "name">) => {
  const pool = readStore()[c.id];
  return pool && pool.name === c.name ? pool : undefined;
};

/** 从存好的留言里取一条并记一次已看；没有就返回 null。 */
export function takeNote(
  c: Pick<Character, "id" | "name">,
  kind: NoteKind,
  exclude?: string,
): string | null {
  const store = readStore();
  const pool = store[c.id];
  if (!pool || pool.name !== c.name) return null;
  const item = pickNote(pool, kind, exclude);
  if (!item) return null;
  item.n += 1;
  pool.at = Date.now();
  writeStore(store);
  return item.t;
}

const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
/** 让 AI 补一批留言并存好；同一角色同一种留言同时只会发一个请求。 */
export function fillNotes(c: Who, kind: NoteKind): Promise<void> {
  const key = `${c.id}:${kind}`;
  const running = inflight.get(key);
  if (running) return running;
  const config = loadConfig();
  if (!aiConfigured(config))
    return Promise.reject(
      new Error("请先在设置中填写 AI 接口地址、模型和密钥"),
    );
  if (!navigator.onLine)
    return Promise.reject(new Error("当前离线，联网后可重新生成"));
  const existing = (poolOf(c)?.[kind] ?? []).map((item) => item.t);
  const haveReplies = poolOf(c)?.replies?.length ?? 0;
  const job = generateBirthdayPack(
    config,
    c,
    kind,
    BATCH,
    existing.slice(-6),
    undefined,
    haveReplies < REPLIES_WANTED ? REPLIES_WANTED : 0,
  )
    .then(({ messages, replies }) => {
      const store = readStore();
      const pool = addToPool(store[c.id], c.name, kind, messages);
      if (replies.length)
        pool.replies = [
          ...new Set([...(pool.replies ?? []), ...replies]),
        ].slice(-MAX_REPLIES);
      store[c.id] = pool;
      writeStore(store);
      failedAt.delete(key);
      window.dispatchEvent(new Event("huiqi-birthday-notes-changed"));
    })
    .catch((error) => {
      failedAt.set(key, Date.now());
      throw error;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** 这个角色生成留言时顺便写好的快捷回复；没触发过留言生成的角色没有。 */
export const savedReplies = (c: Pick<Character, "id" | "name">): string[] =>
  poolOf(c)?.replies ?? [];

const needsRefill = (c: Who, kind: NoteKind) =>
  unseenCount(poolOf(c), kind) < REFILL_BELOW &&
  Date.now() - (failedAt.get(`${c.id}:${kind}`) ?? 0) > RETRY_AFTER;

/** 临近几天内还要备好「当天」的留言，到了生日不用再等。 */
const kindsNeeded = (days: number): NoteKind[] =>
  days <= 0 ? ["today"] : days <= 7 ? ["soon", "today"] : ["soon"];

/** 按顺序补货（不并发，避免一次发出很多请求）。 */
async function refill(targets: { c: Who; days: number }[]) {
  const config = loadConfig();
  if (!aiConfigured(config) || !noteAutoEnabled() || !navigator.onLine) return;
  for (const { c, days } of targets)
    for (const kind of kindsNeeded(days))
      if (needsRefill(c, kind)) await fillNotes(c, kind).catch(() => {});
}

/**
 * 在应用打开、空闲时为最近要过生日的两位角色备好留言，
 * 这样首页打开时寿星卡能直接显示。需要 AI 已配置且没有关闭自动生成。
 */
export function useNotePrefetch(characters: Character[]) {
  const signature = characters
    .map((c) => `${c.id}|${c.name}|${c.birthday?.month}-${c.birthday?.day}`)
    .join(";");
  const latest = useRef(characters);
  latest.current = characters;
  useEffect(() => {
    const run = () => {
      const targets = latest.current
        .map((c) => ({ c, days: daysToBirthday(c) }))
        .filter((x): x is { c: Character; days: number } => x.days !== null)
        .sort((a, b) => a.days - b.days)
        .slice(0, 2);
      void refill(targets);
    };
    const timer = setTimeout(run, 1500);
    window.addEventListener("huiqi-ai-config-changed", run);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("huiqi-ai-config-changed", run);
    };
  }, [signature]);
}

// ---------------------------------------------------------------- 首页寿星卡
export type BirthdayNote =
  | { status: "unconfigured" }
  | { status: "off" }
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "error"; error: string };

/** 这次打开页面时已经选好的留言：在页面之间切换回来不换，刷新页面才换一条新的。 */
const picked = new Map<string, string>();

export function useBirthdayNote(
  character: Character | undefined,
  daysAway: number,
) {
  const kind = noteKind(daysAway);
  // 存好的留言直接作为初始内容，首屏就有字，不会先闪一下「正在收到…」
  const [note, setNote] = useState<BirthdayNote>(() => {
    if (!character) return { status: "loading" };
    const key = `${character.id}:${kind}`;
    const cached = picked.get(key);
    const text =
      (cached && validBirthdayNote(cached) ? cached : undefined) ??
      takeNote(character, kind);
    if (!text) return { status: "loading" };
    picked.set(key, text);
    return { status: "ok", text };
  });
  const seq = useRef(0);
  const run = useCallback(
    async (next: boolean) => {
      const id = ++seq.current;
      if (!character) return;
      const key = `${character.id}:${kind}`;
      const cached = picked.get(key);
      const current = cached && validBirthdayNote(cached) ? cached : undefined;
      let text = next ? undefined : current;
      text ??= takeNote(character, kind, current) ?? undefined;
      if (text) {
        picked.set(key, text);
        setNote({ status: "ok", text });
        // 取走一条后剩下的不多了，空闲时补一批
        setTimeout(() => {
          void refill([{ c: character, days: daysAway }]);
        }, 1500);
        return;
      }
      // 存好的留言用完了（或者还没生成过）：只好现在请求一批
      if (!aiConfigured(loadConfig())) {
        setNote({ status: "unconfigured" });
        return;
      }
      if (!next && !noteAutoEnabled()) {
        setNote({ status: "off" });
        return;
      }
      setNote({ status: "loading" });
      try {
        await fillNotes(character, kind);
        if (id !== seq.current) return;
        const filled = takeNote(character, kind, current);
        if (!filled) throw new Error("AI 没有返回内容");
        picked.set(key, filled);
        setNote({ status: "ok", text: filled });
      } catch (error) {
        if (id !== seq.current) return;
        setNote({
          status: "error",
          error: error instanceof Error ? error.message : "生成失败",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [character?.id, character?.name, kind, daysAway],
  );
  useEffect(() => {
    void run(false);
    const reload = () => void run(false);
    const receiveNotes = () => {
      const current = character && picked.get(`${character.id}:${kind}`);
      if (!current || !validBirthdayNote(current)) void run(false);
    };
    window.addEventListener("huiqi-ai-config-changed", reload);
    window.addEventListener("huiqi-birthday-notes-changed", receiveNotes);
    return () => {
      seq.current++;
      window.removeEventListener("huiqi-ai-config-changed", reload);
      window.removeEventListener("huiqi-birthday-notes-changed", receiveNotes);
    };
  }, [run, character?.id, kind]);
  return { note, refresh: () => void run(true) };
}
