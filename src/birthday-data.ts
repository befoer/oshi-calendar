import type { Character } from "./domain";

// Bangumi identity and birthday infobox verified on 2026-10-10.
// Only consistent Gregorian month/day values are included; no invented dates.
export const birthdaySnapshotDate = "2026-10-10";
const birthdays = new Map<number, { month: number; day: number }>([
  [183099, { month: 7, day: 20 }],
  [132477, { month: 1, day: 14 }],
  [198022, { month: 11, day: 1 }],
  [10439, { month: 10, day: 3 }],
  [87968, { month: 2, day: 21 }],
  [22520, { month: 12, day: 10 }],
  [86143, { month: 5, day: 3 }],
  [72355, { month: 10, day: 17 }],
  [10700, { month: 4, day: 20 }],
  [19527, { month: 8, day: 3 }],
  [19528, { month: 3, day: 20 }],
  [23425, { month: 12, day: 12 }],
  [23648, { month: 12, day: 4 }],
  [32, { month: 4, day: 13 }],
]);

export function birthdayFromSnapshot(current: Character): Character | null {
  if (
    current.deletedAt ||
    current.birthday ||
    current.birthdayConfidence === "uncertain" ||
    current.birthdayConfidence === "none"
  )
    return null;
  const birthday = current.bangumiId
    ? birthdays.get(current.bangumiId)
    : undefined;
  if (!birthday) return null;
  // Preserve an existing manual source or unresolved imported candidate.
  if (
    current.birthdaySource &&
    !current.birthdaySource.includes("未公布可用月日")
  )
    return null;
  return {
    ...current,
    birthday: { ...birthday },
    birthdayConfidence: "confirmed",
    birthdaySource: `https://bgm.tv/character/${current.bangumiId}；原文：${birthday.month}月${birthday.day}日；内置已核对资料（${birthdaySnapshotDate}）`,
  };
}
