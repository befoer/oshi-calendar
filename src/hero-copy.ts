/** 首页顶部的「旁白」文案：像看板娘随口报今天与接下来的日子，不带日期。 */
export type HeroNarrationInput = {
  /** 今天过生日的角色名 */
  todayBirthdays: string[];
  /** 今天之后最近一天的生日（同一天有多位时全部列出） */
  nextBirthday?: { names: string[]; days: number };
  /** 从今天起最近的一个节日或自定义日程 */
  nextHoliday?: { title: string; days: number };
  /** 一个月内其余要过生日的角色（不含上面已经说到的），按时间先后 */
  monthOthers?: string[];
};
/** 第二行最长字数；加上「一个月内还有…」后超过就不显示，保证只占一行。 */
const LINE_LIMIT = 30;

/** 节日离得太远就不再提，免得旁白像在念日历。 */
const HOLIDAY_RANGE = 45;

export const joinNames = (names: string[]) =>
  names.length <= 3
    ? names.join("、")
    : `${names.slice(0, 3).join("、")}等 ${names.length} 位`;

/** 0 → 今天，1 → 明天，2 → 后天，其余 → N 天后。 */
export const relativeDay = (days: number) =>
  days <= 0 ? "今天" : days === 1 ? "明天" : days === 2 ? "后天" : `${days} 天后`;

/** 名字太多时只写前面几个，再用「等 N 位」收尾。 */
export function limitNames(names: string[], maxChars = 10) {
  let shown: string[] = [];
  let used = 0;
  for (const name of names) {
    if (used + name.length > maxChars) break;
    shown.push(name);
    used += name.length;
  }
  if (shown.length === names.length) return names.join("、");
  if (!shown.length) shown = [names[0]];
  return `${shown.join("、")}等 ${names.length} 位`;
}
const withMonth = (line: string, others: string[] = []) => {
  if (!others.length) return line;
  const next = line.replace(/。$/, `；一个月内还有${limitNames(others)}生日。`);
  return next.length <= LINE_LIMIT ? next : line;
};
export function heroNarration(input: HeroNarrationInput): [string, string] {
  const [first, second] = baseNarration(input);
  return [first, withMonth(second, input.monthOthers)];
}
function baseNarration({
  todayBirthdays,
  nextBirthday,
  nextHoliday,
}: HeroNarrationInput): [string, string] {
  const holiday =
    nextHoliday && nextHoliday.days <= HOLIDAY_RANGE ? nextHoliday : undefined;
  const holidayLine = holiday
    ? holiday.days <= 0
      ? `今天还是${holiday.title}。`
      : `${relativeDay(holiday.days)}是${holiday.title}。`
    : "";
  if (todayBirthdays.length) {
    const first = `今天是${joinNames(todayBirthdays)}的生日。`;
    if (holiday && nextBirthday) {
      const lead =
        holiday.days <= 0 ? "今天还是" : `${relativeDay(holiday.days)}是`;
      if (holiday.days === nextBirthday.days)
        return [
          first,
          `${lead}${holiday.title}，也是${joinNames(nextBirthday.names)}的生日。`,
        ];
      return [
        first,
        `${lead}${holiday.title}，${relativeDay(nextBirthday.days)}轮到${joinNames(nextBirthday.names)}。`,
      ];
    }
    if (nextBirthday)
      return [
        first,
        `${relativeDay(nextBirthday.days)}轮到${joinNames(nextBirthday.names)}。`,
      ];
    return [first, holidayLine || "趁着好心情，开始一幅新的创作吧。"];
  }
  if (nextBirthday)
    // 今天没人过生日，不特意说「没有」，直接从下一位寿星说起
    return [
      `${relativeDay(nextBirthday.days)}是${joinNames(nextBirthday.names)}的生日。`,
      holidayLine || "今天没有安排，适合开始新的创作。",
    ];
  // 一位寿星都没有（还没添加角色或生日）：不说「没有」，直接说能做什么
  return holidayLine
    ? [holidayLine, "适合开始一幅新的创作。"]
    : ["适合开始一幅新的创作。", "在角色库里添加角色，生日会出现在这里。"];
}
