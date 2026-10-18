import { expect, it } from "vitest";
import {
  addToPool,
  noteKind,
  pickNote,
  unseenCount,
  type Pool,
} from "./birthday-note";

const pool = (soon: [string, number][], today: [string, number][] = []): Pool => ({
  name: "露露卡",
  soon: soon.map(([t, n]) => ({ t, n })),
  today: today.map(([t, n]) => ({ t, n })),
  at: 1,
});

it("当天与之前分开存：今天是生日用「当天」，其余用「快到了」", () => {
  expect(noteKind(0)).toBe("today");
  expect(noteKind(-1)).toBe("today");
  expect(noteKind(15)).toBe("soon");
});

it("每次取被看得最少的一条，所以连续打开不会重复，直到每条都看过一遍", () => {
  const p = pool([
    ["甲", 1],
    ["乙", 0],
    ["丙", 0],
  ]);
  const first = pickNote(p, "soon", undefined, () => 0)!;
  expect(first.t).toBe("乙");
  first.n += 1;
  const second = pickNote(p, "soon", undefined, () => 0)!;
  expect(second.t).toBe("丙");
  second.n += 1;
  // 全都看过一次后重新开始，并尽量避开当前这条
  expect(pickNote(p, "soon", "丙", () => 0)!.t).not.toBe("丙");
  expect(unseenCount(p, "soon")).toBe(0);
});

it("池子里没有留言时返回 undefined；只有一条时 exclude 不会让它消失", () => {
  expect(pickNote(undefined, "soon")).toBeUndefined();
  expect(pickNote(pool([]), "today")).toBeUndefined();
  expect(pickNote(pool([["唯一", 3]]), "soon", "唯一")!.t).toBe("唯一");
});

it("新留言并入：去重、带上看过次数 0；超过 12 条时丢掉看得最多的", () => {
  const seen = Array.from({ length: 12 }, (_, i): [string, number] => [
    `旧${i}`,
    i < 6 ? 2 : 1,
  ]);
  const next = addToPool(pool(seen), "露露卡", "soon", ["旧0", "新1", "新2"], 9);
  const texts = next.soon.map((item) => item.t);
  expect(texts).toHaveLength(12);
  expect(texts).toContain("新1");
  expect(texts).toContain("新2");
  // 看得最多的（n=2）里最早存进来的被挤掉，较新的留下
  expect(texts).not.toContain("旧0");
  expect(texts).not.toContain("旧1");
  expect(texts).toContain("旧5");
  expect(next.at).toBe(9);
  expect(unseenCount(next, "soon")).toBe(2);
});

it("角色改名后旧留言作废，重新开始存", () => {
  const next = addToPool(pool([["旧", 0]]), "新名字", "soon", ["新"]);
  expect(next.name).toBe("新名字");
  expect(next.soon.map((item) => item.t)).toEqual(["新"]);
  expect(next.today).toEqual([]);
});

it("快捷回复跟着留言池走：加留言时保留，角色改名后作废", () => {
  const withReplies = { ...pool([["旧", 1]]), replies: ["聊点什么？"] };
  expect(addToPool(withReplies, "露露卡", "soon", ["新"]).replies).toEqual(["聊点什么？"]);
  expect(addToPool(withReplies, "新名字", "soon", ["新"]).replies).toBeUndefined();
});
