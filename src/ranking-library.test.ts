import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { addRankingCharacter } from "./ranking-library";
import { db, repository, put } from "./store";
import { newCharacter } from "./domain";

const entry = {
  id: 123,
  name: "测试寿星",
  avatarUrl: "https://example.com/avatar.jpg",
  work: "测试作品",
  month: 10,
  day: 30,
  favourites: 100,
  gender: "Female",
};
beforeEach(async () => {
  await db.delete();
  await db.open();
});
it("快捷添加保存来源、生日和作品；并发点击只添加一次，支持撤销后重新添加", async () => {
  const [first, second] = await Promise.all([
    addRankingCharacter(entry),
    addRankingCharacter(entry),
  ]);
  expect(first.id).toBe(second.id);
  expect(await db.characters.count()).toBe(1);
  expect(await db.logs.count()).toBe(1);
  expect(first).toMatchObject({
    anilistId: 123,
    birthday: { month: 10, day: 30 },
    birthdayConfidence: "confirmed",
    works: ["测试作品"],
    birthdaySource: "https://anilist.co/character/123",
  });
  await repository.undo((await db.logs.toArray())[0].id);
  expect((await repository.snapshot()).characters).toHaveLength(0);
  await addRankingCharacter(entry);
  expect((await repository.snapshot()).characters).toHaveLength(1);
});
it("同作品同名的现有角色保留原资料，不重复添加", async () => {
  const existing = {
    ...newCharacter(entry.name),
    works: [entry.work],
    notes: "保留我的备注",
    bangumiId: 22,
  };
  await put("characters", existing, "添加角色");
  expect((await addRankingCharacter(entry)).id).toBe(existing.id);
  expect((await db.characters.get(existing.id))?.notes).toBe("保留我的备注");
  expect(await db.characters.count()).toBe(1);
});
