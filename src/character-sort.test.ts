import { expect, it } from "vitest";
import { newCharacter, type Character } from "./domain";
import { daysToBirthday, sortCharacters } from "./character-sort";

const make = (
  name: string,
  birthday?: [number, number],
  starred = false,
): Character => ({
  ...newCharacter(name),
  starred,
  birthday: birthday ? { month: birthday[0], day: birthday[1] } : null,
  birthdayConfidence: birthday ? "confirmed" : "unknown",
});
const names = (items: Character[]) => items.map((c) => c.name);
// 列表顺序 = 加入先后（旧 → 新）
const list = [
  make("甲", [12, 25]),
  make("乙"),
  make("丙", [10, 20], true),
  make("丁", [10, 17]),
  make("戊", [1, 3], true),
];

it("距离生日的天数：今年未过按今年算，已过按明年算，没有已确认生日为 null", () => {
  expect(daysToBirthday(list[3], "2026-10-17")).toBe(0);
  expect(daysToBirthday(list[2], "2026-10-17")).toBe(3);
  expect(daysToBirthday(list[4], "2026-10-17")).toBe(78);
  expect(daysToBirthday(list[1], "2026-10-17")).toBeNull();
});

it("生日临近：从今天起最近的在前，没有生日的排最后", () => {
  expect(names(sortCharacters(list, "birthday", "2026-10-17"))).toEqual([
    "丁",
    "丙",
    "甲",
    "戊",
    "乙",
  ]);
});

it("添加顺序是倒序：最新添加的在最前", () => {
  expect(names(sortCharacters(list, "default"))).toEqual([
    "戊",
    "丁",
    "丙",
    "乙",
    "甲",
  ]);
});

it("标星优先与名称排序：并列时沿用最新在前", () => {
  expect(names(sortCharacters(list, "starred"))).toEqual([
    "戊",
    "丙",
    "丁",
    "乙",
    "甲",
  ]);
  const byName = names(sortCharacters(list, "name"));
  expect([...byName].sort((a, b) => a.localeCompare(b, "zh-CN"))).toEqual(
    byName,
  );
  // 不改动传入的数组
  expect(names(list)).toEqual(["甲", "乙", "丙", "丁", "戊"]);
});
