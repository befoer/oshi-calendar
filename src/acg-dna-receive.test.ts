import { expect, it } from "vitest";
import { findExisting, parseAcgMessage, toCharacter } from "./acg-dna-receive";
import { newCharacter } from "./domain";

it("次元属性发来的角色：校验格式，只收本地图片或 Bangumi 图片，带上 Bangumi 编号", () => {
  const list = parseAcgMessage({
    type: "acg-dna:characters",
    version: 1,
    characters: [
      { name: " 洛琪希 ", image: "data:image/png;base64,AAAA", bangumiId: 46465 },
      { name: "洛琪希" },
      { name: "远程", imageUrl: "https://lain.bgm.tv/pic/crt/l/a.jpg", bangumiId: "x" },
      { name: "坏图", imageUrl: "https://evil.example/a.jpg", image: "javascript:alert(1)" },
      { name: "" },
      42,
    ],
  });
  expect(list).toEqual([
    { name: "洛琪希", avatarUrl: "data:image/png;base64,AAAA", bangumiId: 46465 },
    { name: "远程", avatarUrl: "https://lain.bgm.tv/pic/crt/l/a.jpg", bangumiId: null },
    { name: "坏图", avatarUrl: "", bangumiId: null },
  ]);
  expect(parseAcgMessage({ type: "other", version: 1, characters: [] })).toBeNull();
  const c = toCharacter(list![0]);
  expect(c.bangumiId).toBe(46465);
  expect(c.avatarUrl).toContain("data:image/png");
});

it("同一个 Bangumi 角色、同名或别名一致都算已存在", () => {
  const existing = { ...newCharacter("洛琪希·米格路迪亚"), bangumiId: 46465, aliases: ["洛琪希"] };
  expect(findExisting({ name: "Roxy", avatarUrl: "", bangumiId: 46465 }, [existing])).toBe(existing);
  expect(findExisting({ name: "洛琪希", avatarUrl: "", bangumiId: null }, [existing])).toBe(existing);
  expect(findExisting({ name: "艾莉丝", avatarUrl: "", bangumiId: null }, [existing])).toBeUndefined();
});
