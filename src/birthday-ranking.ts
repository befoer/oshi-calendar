import { z } from "zod";
import { fetchAniListBirthdayRanking } from "./anilist";
import { dateOnly } from "./domain";

const entrySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  avatarUrl: z.string(),
  work: z.string(),
  favourites: z.number().int().nonnegative(),
  gender: z.string().nullable(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
export type BirthdayRankingEntry = z.infer<typeof entrySchema>;
export type BirthdayGender = "female" | "male" | "all";
export function filterBirthdayRanking(
  entries: BirthdayRankingEntry[],
  gender: BirthdayGender,
) {
  return gender === "all"
    ? entries
    : entries.filter((entry) => entry.gender?.trim().toLowerCase() === gender);
}
const cacheSchema = z.object({
  date: dateOnly,
  fetchedAt: z.number().finite(),
  entries: z.array(entrySchema).max(5000),
});
const cacheKey = "oshi-birthday-ranking-v2";
const freshFor = 60 * 60 * 1000;

function verifyDate(entries: BirthdayRankingEntry[], date: string) {
  const [, month, day] = date.split("-").map(Number);
  if (entries.some((c) => c.month !== month || c.day !== day))
    throw new Error("AniList 的生日日期尚未与北京时间今天同步，请稍后重试");
  if (new Set(entries.map((c) => c.id)).size !== entries.length)
    throw new Error("AniList 返回了重复角色，请稍后重试");
}

function readCache(date: string) {
  try {
    const value = cacheSchema.parse(
      JSON.parse(localStorage.getItem(cacheKey) || "null"),
    );
    if (value.date !== date || value.fetchedAt > Date.now()) return null;
    verifyDate(value.entries, date);
    return value;
  } catch {
    return null;
  }
}

/** Only the same day's cache is usable, including when the network is offline. */
export async function loadBirthdayRanking(
  date: string,
  signal?: AbortSignal,
  force = false,
): Promise<{ entries: BirthdayRankingEntry[]; warning?: string }> {
  dateOnly.parse(date);
  const cached = readCache(date);
  if (!force && cached && Date.now() - cached.fetchedAt < freshFor)
    return { entries: cached.entries };
  try {
    const entries: BirthdayRankingEntry[] = [];
    for (let page = 1; ; page++) {
      signal?.throwIfAborted();
      const result = await fetchAniListBirthdayRanking(page, signal);
      const batch = z.array(entrySchema).parse(result.entries);
      verifyDate(batch, date);
      entries.push(...batch);
      if (!result.hasNextPage) break;
      if (!batch.length || page >= 100)
        throw new Error("AniList 生日榜尚未完整返回，请稍后重试");
    }
    verifyDate(entries, date);
    entries.sort((a, b) => b.favourites - a.favourites || a.id - b.id);
    signal?.throwIfAborted();
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ date, fetchedAt: Date.now(), entries }),
      );
    } catch {
      // Storage may be disabled; the fetched ranking still works for this visit.
    }
    return { entries };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (cached)
      return {
        entries: cached.entries,
        warning: "暂时无法更新，正在显示今天缓存的排名",
      };
    if (error instanceof z.ZodError)
      throw new Error("AniList 生日榜资料不完整，请稍后重试");
    throw error;
  }
}
