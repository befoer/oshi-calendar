import type { Character } from "./domain";
import { birthdayDate, daysUntil, today } from "./calendar";

export type CharacterSort = "birthday" | "default" | "starred" | "name";

/** 距离下一次生日的天数；没有已确认生日时返回 null。 */
export const daysToBirthday = (
  c: Character,
  now = today(),
): number | null => {
  if (!c.birthday || c.birthdayConfidence !== "confirmed") return null;
  const year = Number(now.slice(0, 4));
  const thisYear = birthdayDate(year, c.birthday.month, c.birthday.day);
  const next =
    thisYear >= now
      ? thisYear
      : birthdayDate(year + 1, c.birthday.month, c.birthday.day);
  return daysUntil(next, now);
};

/**
 * 角色库排序。传入的列表按加入先后（旧 → 新）排列；
 * 「添加顺序」是倒序，最新添加的在最前，其余排序遇到并列项也沿用这个顺序。
 */
export function sortCharacters(
  list: Character[],
  sort: string,
  now = today(),
): Character[] {
  const newestFirst = [...list].reverse();
  const byName = (a: Character, b: Character) =>
    a.name.localeCompare(b.name, "zh-CN");
  if (sort === "starred")
    return newestFirst.sort((a, b) => Number(b.starred) - Number(a.starred));
  if (sort === "birthday")
    return newestFirst.sort(
      (a, b) =>
        (daysToBirthday(a, now) ?? 9999) - (daysToBirthday(b, now) ?? 9999) ||
        byName(a, b),
    );
  if (sort === "name") return newestFirst.sort(byName);
  return newestFirst;
}
