import { expect, it } from "vitest";
import { acgDnaPayload } from "./acg-dna";
import { newCharacter } from "./domain";

it("发给次元属性的数据：名字、最多 6 个作品，只带本地图片头像", async () => {
  const a = { ...newCharacter("洛琪希"), works: ["1", "2", "3", "4", "5", "6", "7"], avatarUrl: "data:image/webp;base64,AAAA" };
  const b = { ...newCharacter("没头像"), avatarUrl: "" };
  const c = { ...newCharacter("动图"), avatarUrl: "data:image/gif;base64,AAAA" };
  const payload = await acgDnaPayload([a, b, c]);
  expect(payload.type).toBe("oshi-calendar:characters");
  expect(payload.version).toBe(1);
  expect(payload.characters).toEqual([
    { name: "洛琪希", works: ["1", "2", "3", "4", "5", "6"], image: "data:image/webp;base64,AAAA" },
    { name: "没头像", works: [] },
    { name: "动图", works: [] },
  ]);
});
