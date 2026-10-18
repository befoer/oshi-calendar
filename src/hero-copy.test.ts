import { expect, it } from "vitest";
import { heroNarration, joinNames, limitNames, relativeDay } from "./hero-copy";

it("相对日期：今天、明天、后天，其余写成 N 天后", () => {
  expect([0, 1, 2, 15].map(relativeDay)).toEqual([
    "今天",
    "明天",
    "后天",
    "15 天后",
  ]);
});

it("名字最多列三个，其余折成「等 N 位」", () => {
  expect(joinNames(["甲", "乙"])).toBe("甲、乙");
  expect(joinNames(["甲", "乙", "丙", "丁"])).toBe("甲、乙、丙等 4 位");
});

it("今天有生日：先报寿星，再报最近的节日与下一位寿星", () => {
  expect(
    heroNarration({
      todayBirthdays: ["灰之魔女（伊蕾娜）"],
      nextBirthday: { names: ["露露卡"], days: 15 },
      nextHoliday: { title: "重阳节", days: 1 },
    }),
  ).toEqual([
    "今天是灰之魔女（伊蕾娜）的生日。",
    "明天是重阳节，15 天后轮到露露卡。",
  ]);
});

it("节日和下一位寿星同一天、节日就是今天、节日太远时的措辞", () => {
  expect(
    heroNarration({
      todayBirthdays: ["甲"],
      nextBirthday: { names: ["乙"], days: 3 },
      nextHoliday: { title: "中秋节", days: 3 },
    })[1],
  ).toBe("3 天后是中秋节，也是乙的生日。");
  expect(
    heroNarration({
      todayBirthdays: ["甲"],
      nextBirthday: { names: ["乙"], days: 3 },
      nextHoliday: { title: "国庆节", days: 0 },
    })[1],
  ).toBe("今天还是国庆节，3 天后轮到乙。");
  expect(
    heroNarration({
      todayBirthdays: ["甲"],
      nextBirthday: { names: ["乙"], days: 2 },
      nextHoliday: { title: "冬至", days: 60 },
    })[1],
  ).toBe("后天轮到乙。");
});

it("今天没有生日：不特意说「没有」，直接从下一位寿星说起；什么都没有时给一句鼓励", () => {
  expect(
    heroNarration({
      todayBirthdays: [],
      nextBirthday: { names: ["露露卡"], days: 15 },
      nextHoliday: { title: "重阳节", days: 1 },
    }),
  ).toEqual(["15 天后是露露卡的生日。", "明天是重阳节。"]);
  expect(
    heroNarration({
      todayBirthdays: [],
      nextBirthday: { names: ["露露卡"], days: 1 },
    })[0],
  ).toBe("明天是露露卡的生日。");
  expect(
    heroNarration({
      todayBirthdays: [],
      nextBirthday: { names: ["甲", "乙"], days: 40 },
    })[0],
  ).toBe("40 天后是甲、乙的生日。");
  expect(heroNarration({ todayBirthdays: [] })).toEqual([
    "适合开始一幅新的创作。",
    "在角色库里添加角色，生日会出现在这里。",
  ]);
  expect(
    heroNarration({ todayBirthdays: [], nextHoliday: { title: "冬至", days: 3 } }),
  ).toEqual(["3 天后是冬至。", "适合开始一幅新的创作。"]);
  expect(heroNarration({ todayBirthdays: ["甲"] })[1]).toContain("创作");
});

it("一个月内的其余角色接在第二行后面，名字多就收尾成「等 N 位」，太长就不显示", () => {
  expect(limitNames(["甲", "乙"])).toBe("甲、乙");
  expect(limitNames(["露露卡", "香风智乃", "和泉纱雾", "白"])).toBe("露露卡、香风智乃等 4 位");
  expect(
    heroNarration({
      todayBirthdays: [],
      nextBirthday: { names: ["甲"], days: 3 },
      nextHoliday: { title: "重阳节", days: 1 },
      monthOthers: ["乙", "丙"],
    })[1],
  ).toBe("明天是重阳节；一个月内还有乙、丙生日。");
  // 加上之后超过一行（30 字）就不显示
  expect(
    heroNarration({
      todayBirthdays: [],
      nextBirthday: { names: ["甲"], days: 3 },
      nextHoliday: { title: "一个名字很长很长的节日", days: 1 },
      monthOthers: ["很长很长的角色名", "另一个"],
    })[1],
  ).toBe("明天是一个名字很长很长的节日。");
});
