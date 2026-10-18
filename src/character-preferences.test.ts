import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, patchCharacter, put, repository } from "./store";
import { newCharacter } from "./domain";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

it("标星与头像本地化不写操作记录，也不会让之前的修改无法撤销", async () => {
  const c = newCharacter("标星测试");
  c.avatarUrl = "https://lain.bgm.tv/pic/crt/l/a.jpg";
  await put("characters", c, "新增角色");
  const [log] = await db.logs.toArray();
  const edited = { ...c, notes: "改过的备注" };
  await put("characters", edited, "修改备注");
  const logsBefore = await db.logs.count();

  await patchCharacter(c.id, { starred: true });
  await patchCharacter(
    c.id,
    { avatarUrl: "data:image/webp;base64,AAAA" },
    c.avatarUrl,
  );
  const saved = await db.characters.get(c.id);
  expect(saved).toMatchObject({
    starred: true,
    avatarUrl: "data:image/webp;base64,AAAA",
    notes: "改过的备注",
  });
  expect(await db.logs.count()).toBe(logsBefore);

  // 最近一次的修改仍可撤销，并且不会把标星/本地头像一并撤掉
  const second = (await db.logs.toArray()).find((l) => l.summary === "修改备注")!;
  await repository.undo(second.id);
  expect(await db.characters.get(c.id)).toMatchObject({
    starred: true,
    avatarUrl: "data:image/webp;base64,AAAA",
    notes: "",
  });
  expect(log.id).toBeTruthy();
});

it("头像已被别的修改替换时，不会用旧地址的本地副本覆盖", async () => {
  const c = newCharacter("换头像");
  c.avatarUrl = "https://lain.bgm.tv/pic/crt/l/old.jpg";
  await put("characters", c, "新增角色");
  await put(
    "characters",
    { ...c, avatarUrl: "https://lain.bgm.tv/pic/crt/l/new.jpg" },
    "换头像",
  );
  await patchCharacter(
    c.id,
    { avatarUrl: "data:image/webp;base64,OLD" },
    "https://lain.bgm.tv/pic/crt/l/old.jpg",
  );
  expect((await db.characters.get(c.id))?.avatarUrl).toBe(
    "https://lain.bgm.tv/pic/crt/l/new.jpg",
  );
});

it("旧版备份没有 starred 字段时按未标星导入", async () => {
  const { validateBackup } = await import("./store");
  const old = newCharacter("旧备份") as Record<string, unknown>;
  delete old.starred;
  const backup = validateBackup({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    characters: [old],
    events: [],
    tasks: [],
    recommendations: [],
    settings: {
      id: "main",
      reminderDays: 14,
      defaultView: "home",
      timezone: "Asia/Shanghai",
      extraHolidays: true,
      solarTerms: true,
      excludedHolidays: [],
      theme: "system",
    },
  });
  expect(backup.characters[0].starred).toBe(false);
});
