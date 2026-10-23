import { characterSchema, type Character, type Operation } from "./domain";
import { db, repository } from "./store";
import { externalJSON } from "./external-network";
import { findAniListFallback, searchAniList } from "./anilist";
export type BangumiCharacter = {
  id: number;
  provider?: "anilist";
  name: string;
  images?: { medium?: string; large?: string; small?: string };
  birth_mon?: number;
  birth_day?: number;
  infobox?: { key: string; value: string | { k?: string; v: string }[] }[];
  summary?: string;
  works?: string[];
};
const api = async (path: string, init?: RequestInit) => {
  return externalJSON("Bangumi", "https://api.bgm.tv/v0" + path, init);
};
export const characterSourceURL = (c: BangumiCharacter) =>
  c.provider === "anilist"
    ? `https://anilist.co/character/${c.id}`
    : `https://bgm.tv/character/${c.id}`;
export async function searchBangumi(
  query: string,
): Promise<BangumiCharacter[]> {
  const id = query.match(/(?:character\/|^)(\d+)(?:[/?#].*)?$/)?.[1];
  if (id) return [await detailBangumi(Number(id))];
  const result = await api("/search/characters?limit=10", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword: query, filter: { nsfw: false } }),
  });
  return result.data ?? [];
}
const worksCache = new Map<number, string[]>();
/** 角色出现的作品（最多 6 个）；同一角色只请求一次。失败时返回空列表。 */
export async function fetchBangumiWorks(id: number): Promise<string[]> {
  const cached = worksCache.get(id);
  if (cached) return cached;
  try {
    const subjects = await api(`/characters/${id}/subjects`);
    const works = [
      ...new Set((subjects as any[]).map((s) => s.name_cn || s.name)),
    ].slice(0, 6);
    worksCache.set(id, works);
    return works;
  } catch {
    return [];
  }
}
export async function detailBangumi(id: number): Promise<BangumiCharacter> {
  // 角色资料和作品互不依赖，同时请求
  const [c, works] = await Promise.all([
    fetchBangumiCharacter(id),
    fetchBangumiWorks(id),
  ]);
  c.works = works;
  return c;
}
export async function fetchBangumiCharacter(
  id: number,
): Promise<BangumiCharacter> {
  const c = await api(`/characters/${id}`);
  if (c.id !== id) throw new Error("Bangumi 返回的角色 ID 不匹配");
  return c;
}
export const info = (c: BangumiCharacter, key: string) => {
  const v = c.infobox?.find((i) => i.key === key)?.value;
  return typeof v === "string" ? v : "";
};
export const bgmName = (c: BangumiCharacter) => info(c, "简体中文名") || c.name;
const identityKey = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function matchCharacterCandidate(
  current: Character,
  candidates: BangumiCharacter[],
): BangumiCharacter | null {
  const names = [current.name, ...current.aliases]
    .map(identityKey)
    .filter(Boolean);
  const works = current.works.map(identityKey).filter(Boolean);
  const matched = candidates.filter((candidate) => {
    const aliases = candidate.infobox?.find(
      (field) => field.key === "别名",
    )?.value;
    const fullNames = [
      candidate.name,
      bgmName(candidate),
      ...(typeof aliases === "string"
        ? [aliases]
        : (aliases?.map((alias) => alias.v) ?? [])),
    ];
    // 「帕秋莉·诺蕾姬」也认「帕秋莉」：取间隔号前的名字（至少两个字）
    const givenNames = fullNames
      .map((name) => name.split(/[・·•‧･]/)[0]?.trim() ?? "")
      .filter((name) => [...name].length >= 2);
    const externalNames = [...fullNames, ...givenNames]
      .map(identityKey)
      .filter(Boolean);
    return (
      externalNames.some((name) => names.includes(name)) &&
      (!works.length ||
        works.some((work) =>
          candidate.works?.some((title) => {
            const normalized = identityKey(title);
            return (
              normalized === work ||
              (Math.min(normalized.length, work.length) >= 3 &&
                (normalized.includes(work) || work.includes(normalized)))
            );
          }),
        ))
    );
  });
  const unique = [
    ...new Map(
      matched.map((c) => [`${c.provider ?? "bangumi"}:${c.id}`, c]),
    ).values(),
  ];
  return unique.length === 1 ? unique[0] : null;
}
export function birthdayCandidate(c: BangumiCharacter) {
  const raw = info(c, "生日");
  const match = raw.match(/(\d{1,2})月(\d{1,2})日/);
  const month = c.birth_mon || Number(match?.[1]),
    day = c.birth_day || Number(match?.[2]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  const validDate =
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    date.getUTCMonth() === month - 1;
  return {
    month,
    day,
    raw,
    valid: validDate,
    conflict:
      !!raw &&
      (!match || Number(match[1]) !== month || Number(match[2]) !== day),
  };
}
export function automaticBirthdayUpdate(
  current: Character,
  c: BangumiCharacter,
  fetchedAt: string,
): Character {
  const b = birthdayCandidate(c);
  const source = `${characterSourceURL(c)}；原文：${b.raw || "未提供"}；API：${b.month || "?"}/${b.day || "?"}`;
  // Existing dates are user-owned, including uncertain dates awaiting review.
  const avatarUrl =
    current.avatarUrl || c.images?.medium || c.images?.large || "";
  if (current.birthday || current.birthdayConfidence === "none")
    return {
      ...current,
      avatarUrl,
      birthdayFetchedAt:
        avatarUrl !== current.avatarUrl ? fetchedAt : current.birthdayFetchedAt,
    };
  const conflict =
    b.conflict ||
    current.birthdayConfidence === "uncertain" ||
    (c.provider === "anilist" && current.bangumiId === 46465);
  return {
    ...current,
    birthdayFetchedAt: fetchedAt,
    ...(c.provider === "anilist" ? { anilistId: c.id } : {}),
    birthday: b.valid && !conflict ? { month: b.month, day: b.day } : null,
    birthdayConfidence:
      b.valid && !conflict ? "confirmed" : conflict ? "uncertain" : "unknown",
    birthdaySource:
      (c.provider === "anilist" && current.birthdaySource
        ? current.birthdaySource + "；备用资料："
        : "") +
      source +
      (conflict
        ? "；来源冲突，待确认"
        : b.valid
          ? "；自动获取"
          : "；未公布可用月日"),
    avatarUrl:
      current.bangumiId === 183099 && current.avatarUrl.includes("3218_crt_")
        ? c.images?.medium || current.avatarUrl
        : avatarUrl,
  };
}
export type BirthdaySyncResult = {
  updated: number;
  linked: number;
  avatars: number;
  unresolved: number;
  failed: number;
  errors: string[];
  fallback: number;
  candidates: { characterId: string; results: BangumiCharacter[] }[];
};
let birthdayFlight: Promise<BirthdaySyncResult> | null = null;
export function syncBirthdays(force = false): Promise<BirthdaySyncResult> {
  if (birthdayFlight)
    return force
      ? birthdayFlight.catch(() => undefined).then(() => syncBirthdays(true))
      : birthdayFlight;
  birthdayFlight = (async () => {
    const now = new Date().toISOString();
    const chars = (await repository.snapshot()).characters.filter(
      (c) =>
        (c.bangumiId || c.anilistId || force) &&
        ((!c.birthday && c.birthdayConfidence !== "none") ||
          !c.avatarUrl ||
          (force && !c.bangumiId && !c.anilistId)) &&
        (force ||
          !c.birthdayFetchedAt ||
          Date.now() - Date.parse(c.birthdayFetchedAt) > 24 * 60 * 60 * 1000),
    );
    const fetched: {
      current: Character;
      remote: BangumiCharacter;
      base: Character;
    }[] = [];
    const errors: string[] = [];
    const candidates: BirthdaySyncResult["candidates"] = [];
    let failed = 0,
      fallback = 0,
      unresolvedMissing = 0;
    for (let i = 0; i < chars.length; i += 3) {
      const results = await Promise.allSettled(
        chars.slice(i, i + 3).map(async (original) => {
          if (!original.bangumiId && !original.anilistId) {
            let results: BangumiCharacter[];
            let primaryError: unknown;
            try {
              results = await searchBangumi(original.name);
            } catch (error) {
              primaryError = error;
              results = [];
            }
            if (!results.length) {
              try {
                results = await searchAniList(original.name, original);
              } catch (error) {
                if (primaryError instanceof Error && error instanceof Error)
                  throw new Error(`${primaryError.message}；${error.message}`);
                if (primaryError) throw primaryError;
                throw error;
              }
            }
            // Search pages may omit aliases, subjects and full birthday fields.
            // Validate against detailed records rather than the first result.
            const detailed = await Promise.allSettled(
              results
                .slice(0, 10)
                .map((candidate) =>
                  candidate.provider === "anilist"
                    ? Promise.resolve(candidate)
                    : detailBangumi(candidate.id),
                ),
            );
            const complete = detailed.flatMap((result) =>
              result.status === "fulfilled" ? [result.value] : [],
            );
            const selected = detailed.every(
              (result) => result.status === "fulfilled",
            )
              ? matchCharacterCandidate(original, complete)
              : null;
            if (!selected) {
              candidates.push({
                characterId: original.id,
                results: results.map((candidate, index) =>
                  detailed[index]?.status === "fulfilled"
                    ? detailed[index].value
                    : candidate,
                ),
              });
              if (detailed.some((result) => result.status === "rejected")) {
                failed++;
                const message = `${original.name}：部分候选资料读取失败，暂未自动关联`;
                if (!errors.includes(message)) errors.push(message);
              }
              return null;
            }
            if (selected.provider === "anilist") fallback++;
            const aliases = selected.infobox?.find(
              (field) => field.key === "别名",
            )?.value;
            const base: Character = {
              ...original,
              ...(selected.provider === "anilist"
                ? { anilistId: selected.id }
                : { bangumiId: selected.id }),
              aliases: [
                ...new Set([
                  ...original.aliases,
                  selected.name,
                  ...(Array.isArray(aliases)
                    ? aliases.map((alias) => alias.v)
                    : []),
                ]),
              ].filter(Boolean),
              works: [
                ...new Set([...original.works, ...(selected.works ?? [])]),
              ],
            };
            return { current: original, remote: selected, base };
          }
          let current = original;
          let remote: BangumiCharacter | null = null;
          let primaryError: unknown;
          let alternateConnected = false;
          if (current.bangumiId) {
            try {
              remote = await fetchBangumiCharacter(current.bangumiId);
            } catch (error) {
              primaryError = error;
            }
          }
          if (
            !remote ||
            (current.birthdayConfidence !== "none" &&
              (!birthdayCandidate(remote).valid ||
                birthdayCandidate(remote).conflict))
          ) {
            if (remote) current = automaticBirthdayUpdate(current, remote, now);
            try {
              const alternate = await findAniListFallback(
                current,
                remote ?? undefined,
              );
              alternateConnected = true;
              if (alternate) {
                remote = alternate;
                fallback++;
              }
            } catch (error) {
              if (!remote) {
                if (primaryError instanceof Error && error instanceof Error)
                  throw new Error(`${primaryError.message}；${error.message}`);
                throw error;
              }
            }
          }
          if (!remote) {
            if (primaryError && !alternateConnected) throw primaryError;
            return null;
          }
          return { current: original, remote, base: current };
        }),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value) fetched.push(result.value);
          else unresolvedMissing++;
        } else {
          failed++;
          const error = result.reason;
          const message =
            error?.name === "TimeoutError" || error?.name === "AbortError"
              ? "请求超时，浏览器未能连接 Bangumi"
              : error instanceof TypeError
                ? "浏览器无法访问 Bangumi，请检查网络或跨域限制"
                : error instanceof Error
                  ? error.message
                  : "请求失败";
          if (!errors.includes(message)) errors.push(message);
        }
      }
    }
    const operations: Operation[] = [];
    const expected: { collection: string; id: string; value: string }[] = [];
    let updated = 0,
      linked = 0,
      avatars = 0,
      unresolved = 0;
    for (const { current, remote, base } of fetched) {
      const fresh = await db.characters.get(current.id);
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(current)) continue;
      const next = characterSchema.parse(
        automaticBirthdayUpdate(base, remote, now),
      );
      if (
        !current.bangumiId &&
        !current.anilistId &&
        current.birthdaySource &&
        next.birthdaySource !== current.birthdaySource
      )
        next.birthdaySource = `${current.birthdaySource}\n\n${next.birthdaySource}`;
      if (next.birthday && !current.birthday) updated++;
      else if (!next.birthday && next.birthdayConfidence !== "none")
        unresolved++;
      if (!current.avatarUrl && next.avatarUrl) avatars++;
      if (
        !current.bangumiId &&
        !current.anilistId &&
        (next.bangumiId || next.anilistId)
      )
        linked++;
      operations.push({
        collection: "characters",
        action: "put",
        record: next,
      });
      expected.push({
        collection: "characters",
        id: current.id,
        value: JSON.stringify(current),
      });
    }
    for (let i = 0; i < operations.length; i += 50)
      await repository.apply(
        operations.slice(i, i + 50),
        "自动关联及获取角色资料（Bangumi / AniList）",
        crypto.randomUUID(),
        expected.slice(i, i + 50),
      );
    return {
      updated,
      linked,
      avatars,
      unresolved: unresolved + unresolvedMissing,
      failed,
      errors,
      fallback,
      candidates,
    };
  })().finally(() => {
    birthdayFlight = null;
  });
  return birthdayFlight;
}
export function mergeBangumi(
  current: Character,
  c: BangumiCharacter,
  confirmedBirthday: boolean,
): Character {
  confirmedBirthday =
    confirmedBirthday && current.birthdayConfidence !== "none";
  const b = birthdayCandidate(c);
  const aliases = c.infobox?.find((i) => i.key === "别名")?.value;
  return {
    ...current,
    ...(c.provider === "anilist" ? { anilistId: c.id } : { bangumiId: c.id }),
    avatarUrl: c.images?.medium || c.images?.large || "",
    aliases: [
      ...new Set([
        ...current.aliases,
        c.name,
        ...(Array.isArray(aliases) ? aliases.map((a) => a.v) : []),
      ]),
    ],
    works: [...new Set([...current.works, ...(c.works ?? [])])],
    birthday:
      confirmedBirthday && b.valid
        ? { month: b.month, day: b.day }
        : current.birthday,
    birthdayConfidence:
      confirmedBirthday && b.valid ? "confirmed" : current.birthdayConfidence,
    birthdaySource:
      current.birthday && !confirmedBirthday
        ? current.birthdaySource
        : `${characterSourceURL(c)}；原文：${b.raw || "未提供"}；API：${b.month || "?"}/${b.day || "?"}`,
  };
}
