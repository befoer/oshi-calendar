import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  isLeapYear,
  startOfDay,
} from "date-fns";
import { Solar, Lunar } from "lunar-javascript";
import { stamp, type Data, type Recommendation } from "./domain";

export type Occurrence = {
  id: string;
  title: string;
  date: string;
  type: "birthday" | "holiday" | "custom" | "task";
  characterIds: string[];
  tags: string;
  reminderDays: number;
  note?: string;
  recurring?: boolean;
  month?: number;
  day?: number;
  status?: string;
};
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const localDate = (s: string) => new Date(s + "T12:00:00");
export const dateKey = (d: Date) => format(d, "yyyy-MM-dd");
export const daysUntil = (date: string, from = today()) =>
  differenceInCalendarDays(localDate(date), localDate(from));
export const birthdayDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(month === 2 && day === 29 && !isLeapYear(new Date(year, 0, 1)) ? 28 : day).padStart(2, "0")}`;
export const lunarDate = (
  year: number,
  month: number,
  day: number,
): string | null => {
  try {
    const lunar = Lunar.fromYmd(year, month, day);
    const solar = lunar.getSolar();
    if (
      solar.getLunar().getMonth() !== month ||
      solar.getLunar().getDay() !== day
    )
      return null;
    return solar.toYmd();
  } catch {
    return null;
  }
};
const solarHolidays: [number, number, string, boolean?][] = [
  [1, 1, "元旦"],
  [2, 14, "情人节", true],
  [3, 8, "妇女节"],
  [5, 1, "劳动节"],
  [6, 1, "儿童节"],
  [7, 7, "七夕（日本）", true],
  [10, 1, "国庆节"],
  [10, 31, "万圣节", true],
  [12, 25, "圣诞节", true],
];
const lunarHolidays: [number, number, string][] = [
  [1, 1, "春节"],
  [1, 15, "元宵节"],
  [5, 5, "端午节"],
  [7, 7, "七夕"],
  [8, 15, "中秋节"],
  [9, 9, "重阳节"],
];
export function occurrences(
  data: Data,
  start: string,
  end: string,
  includeExcluded = false,
): Occurrence[] {
  const out: Occurrence[] = [];
  const fromYear = Number(start.slice(0, 4)),
    toYear = Number(end.slice(0, 4));
  for (let year = fromYear - 1; year <= toYear; year++) {
    for (const c of data.characters)
      if (c.birthday && c.birthdayConfidence === "confirmed")
        out.push({
          id: `birthday:${c.id}:${year}`,
          title: `${c.name} · 生日`,
          date: birthdayDate(year, c.birthday.month, c.birthday.day),
          type: "birthday",
          characterIds: [c.id],
          tags: "",
          reminderDays: c.reminderDays ?? data.settings.reminderDays,
          note:
            c.birthday.month === 2 &&
            c.birthday.day === 29 &&
            !isLeapYear(new Date(year, 0, 1))
              ? "闰日生日，平年按 2 月 28 日提醒"
              : undefined,
          recurring: true,
          month: c.birthday.month,
          day: c.birthday.day,
        });
    for (const [month, day, title, extra] of solarHolidays)
      if (!extra || data.settings.extraHolidays)
        out.push({
          id: `holiday:${title}:${year}`,
          title,
          date: birthdayDate(year, month, day),
          type: "holiday",
          characterIds: [],
          tags: "",
          reminderDays: data.settings.reminderDays,
          recurring: true,
          month,
          day,
        });
    for (const [month, day, title] of lunarHolidays) {
      const date = lunarDate(year, month, day);
      if (date)
        out.push({
          id: `lunar:${title}:${year}`,
          title,
          date,
          type: "holiday",
          characterIds: [],
          tags: "",
          reminderDays: data.settings.reminderDays,
        });
    }
    if (data.settings.solarTerms) {
      const terms = {
        ...Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable(),
        冬至: Solar.fromYmd(year + 1, 6, 1)
          .getLunar()
          .getJieQiTable()["冬至"],
      };
      for (const [title, solar] of Object.entries(terms) as [string, any][])
        if (/^[\u4e00-\u9fff]+$/.test(title) && solar.getYear() === year)
          out.push({
            id: `term:${title}:${year}`,
            title,
            date: solar.toYmd(),
            type: "holiday",
            characterIds: [],
            tags: "",
            reminderDays: data.settings.reminderDays,
            note: "二十四节气",
          });
    }
    for (const e of data.events) {
      const date =
        e.recurrence === "once"
          ? e.date
          : e.recurrence === "solar"
            ? birthdayDate(year, e.month, e.day)
            : lunarDate(year, e.month, e.day);
      if (
        date &&
        (e.recurrence !== "once" || year === Number(e.date.slice(0, 4)))
      )
        out.push({
          id: `custom:${e.id}:${year}`,
          title: e.title,
          date,
          type: "custom",
          characterIds: [],
          tags: "",
          reminderDays: e.reminderDays ?? data.settings.reminderDays,
          note: e.notes,
          recurring: e.recurrence === "solar",
          month: e.month,
          day: e.day,
        });
    }
  }
  for (const t of data.tasks)
    out.push({
      id: `task:${t.id}`,
      title: t.title,
      date: t.date,
      type: "task",
      characterIds: t.characterIds,
      tags: t.positive,
      reminderDays: 0,
      status: t.status,
    });
  return out
    .filter(
      (e) =>
        e.date >= start &&
        e.date <= end &&
        (includeExcluded || !isHolidayExcluded(e, data)),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
}
export const holidayKey = (e: Occurrence) => e.id.replace(/:\d{4}$/, "");
export const isHolidayExcluded = (e: Occurrence, data: Data) =>
  (e.type === "holiday" || e.type === "custom") &&
  (data.settings.excludedHolidays ?? []).includes(holidayKey(e));
export function upcomingHolidays(
  data: Data,
  start = today(),
  filter = "all",
  includeExcluded = false,
  limit = 5,
) {
  const seen = new Set<string>();
  return occurrences(
    data,
    start,
    dateKey(addMonths(localDate(start), 24)),
    includeExcluded,
  )
    .filter(
      (e) =>
        (e.type === "holiday" || e.type === "custom") &&
        (filter === "all" ||
          (filter === "custom"
            ? e.type === "custom"
            : e.id.startsWith(filter + ":"))),
    )
    .filter((e) => {
      const key = holidayKey(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, includeExcluded ? undefined : limit);
}
export const themes = [
  "新年初雪",
  "冬日咖啡馆",
  "春日樱花",
  "雨后花园",
  "初夏微风",
  "梅雨来信",
  "夏日海边",
  "夏夜祭典",
  "秋日校园",
  "红叶散步",
  "暖光书房",
  "冬日星光",
];
export function localRecommendations(
  data: Data,
  start = today(),
): Recommendation[] {
  const begin = localDate(start);
  const end = dateKey(addMonths(begin, 12));
  const monthly: Recommendation[] = Array.from(
    { length: begin.getDate() === 1 ? 12 : 13 },
    (_, i) => {
      const d = addMonths(begin, i);
      const title = themes[d.getMonth()];
      return {
        ...stamp(),
        id: `local:${dateKey(d).slice(0, 7)}`,
        title,
        dateStart:
          i === 0 ? start : dateKey(new Date(d.getFullYear(), d.getMonth(), 1)),
        dateEnd:
          i === 12
            ? dateKey(addDays(localDate(end), -1))
            : dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
        reason: `${d.getMonth() + 1} 月季节主题`,
        tags: "",
        characterIds: data.characters.length
          ? [data.characters[i % data.characters.length].id]
          : [],
        source: "local",
      };
    },
  );
  const events = occurrences(data, start, end)
    .filter((e) => e.type !== "task")
    .map((e) => ({
      ...stamp(),
      id: `local:${e.id}`,
      title: e.title,
      dateStart: dateKey(addDays(localDate(e.date), -e.reminderDays)),
      dateEnd: e.date,
      reason: `围绕 ${e.date} 的${e.type === "birthday" ? "角色生日" : "节日"}提前安排`,
      tags: "",
      characterIds: e.characterIds,
      source: "local" as const,
    }));
  return [...monthly, ...events].sort((a, b) =>
    a.dateStart.localeCompare(b.dateStart),
  );
}
const escapeICS = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
const foldLine = (line: string) => {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > 75) {
      parts.push(current);
      current = " ";
      size = 1;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n");
};
export function toICS(events: Occurrence[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Huiqi//Character Calendar//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const seen = new Set<string>();
  for (const e of events) {
    const recurring = e.recurring && !(e.month === 2 && e.day === 29);
    const key = recurring ? e.id.replace(/:\d{4}$/, "") : e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${key}@huiqi.local`,
      `DTSTAMP:${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${dateKey(addDays(localDate(e.date), 1)).replace(/-/g, "")}`,
      `SUMMARY:${escapeICS(e.title)}`,
      `DESCRIPTION:${escapeICS([e.note, e.type === "task" ? e.tags : ""].filter(Boolean).join("\n"))}`,
    );
    if (recurring) lines.push("RRULE:FREQ=YEARLY");
    if (e.reminderDays >= 0)
      lines.push(
        "BEGIN:VALARM",
        `TRIGGER:-P${e.reminderDays}D`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeICS(e.title)}`,
        "END:VALARM",
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
export function download(
  filename: string,
  text: string,
  mime = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
