import { z } from "zod";

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }, "日期不存在");
const monthDay = z
  .object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .refine((v) => {
    const d = new Date(Date.UTC(2000, v.month - 1, v.day));
    return d.getUTCMonth() === v.month - 1;
  }, "月日不存在");
const base = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
};
const avatarSchema = z
  .string()
  .refine(
    (s) =>
      !s ||
      /^https?:\/\//i.test(s) ||
      /^data:image\/(png|jpeg|webp|gif);base64,/i.test(s),
    "头像需为 HTTP 图片地址或本地图片",
  );
export const presetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    positive: z.string(),
    negative: z.string().default(""),
    model: z.string().default(""),
    notes: z.string().default(""),
  })
  .strict();
export const characterSchema = z
  .object({
    ...base,
    name: z.string().trim().min(1),
    aliases: z.array(z.string()).default([]),
    works: z.array(z.string()).default([]),
    avatarUrl: avatarSchema.default(""),
    bangumiId: z.number().int().positive().nullable().default(null),
    anilistId: z.number().int().positive().nullable().default(null),
    birthday: monthDay.nullable().default(null),
    birthdaySource: z.string().default(""),
    birthdayFetchedAt: z.string().default(""),
    birthdayConfidence: z
      .enum(["confirmed", "uncertain", "unknown", "none"])
      .default("unknown"),
    reminderDays: z.number().int().min(0).max(365).nullable().default(null),
    presets: z.array(presetSchema).min(1),
    defaultPresetId: z.string(),
    notes: z.string().default(""),
    starred: z.boolean().default(false),
    /** 人物特征（发色、瞳色、服装等），单独保存，不随“复制 Tag”复制 */
    traits: z.string().default(""),
    /** 聊天设定：开场白、性格补充、示例对话（都可留空），聊天时带给 AI */
    chatGreeting: z.string().default(""),
    chatPersonality: z.string().default(""),
    chatExamples: z.string().default(""),
    /** 头像显示位置：锚点（0–100%，0=顶/左，100=底/右）与缩放，用于裁掉图片顶部过大的空白 */
    avatarX: z.number().min(0).max(100).default(50),
    avatarY: z.number().min(0).max(100).default(18),
    avatarZoom: z.number().min(1).max(3).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.presets.some((p) => p.id === v.defaultPresetId))
      ctx.addIssue({ code: "custom", message: "默认预设不存在" });
    if (new Set(v.presets.map((p) => p.id)).size !== v.presets.length)
      ctx.addIssue({ code: "custom", message: "预设 ID 重复" });
    if (v.birthdayConfidence === "confirmed" && !v.birthday)
      ctx.addIssue({ code: "custom", message: "确认生日前请填写月日" });
    if (v.birthdayConfidence === "none" && v.birthday)
      ctx.addIssue({
        code: "custom",
        message: "无生日角色不能同时设置生日月日",
      });
  });
export const eventSchema = z
  .object({
    ...base,
    title: z.string().trim().min(1),
    recurrence: z.enum(["once", "solar", "lunar"]),
    date: dateOnly,
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    reminderDays: z.number().int().min(0).max(365).nullable().default(null),
    tags: z.string().default(""),
    notes: z.string().default(""),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.recurrence === "lunar"
        ? v.day > 30
        : !monthDay.safeParse({ month: v.month, day: v.day }).success
    )
      ctx.addIssue({ code: "custom", message: "月日不存在" });
  });
export const taskSchema = z
  .object({
    ...base,
    title: z.string().trim().min(1),
    date: dateOnly,
    characterIds: z.array(z.string()).default([]),
    status: z.enum(["todo", "doing", "done", "skipped"]).default("todo"),
    positive: z.string().default(""),
    negative: z.string().default(""),
    notes: z.string().default(""),
  })
  .strict();
export const recommendationSchema = z
  .object({
    ...base,
    title: z.string().trim().min(1),
    dateStart: dateOnly,
    dateEnd: dateOnly,
    reason: z.string(),
    tags: z.string(),
    characterIds: z.array(z.string()),
    source: z.enum(["local", "ai"]),
  })
  .strict()
  .refine((v) => v.dateEnd >= v.dateStart, "日期范围倒置");
export const settingsSchema = z
  .object({
    id: z.literal("main"),
    reminderDays: z.number().int().min(0).max(365),
    defaultView: z.enum([
      "home",
      "calendar",
      "characters",
      "recommendations",
      "tasks",
    ]),
    timezone: z.literal("Asia/Shanghai"),
    extraHolidays: z.boolean(),
    solarTerms: z.boolean(),
    excludedHolidays: z.array(z.string().min(1)).default([]),
    theme: z.enum(["system", "light", "dark"]).default("system"),
  })
  .strict();
export type Character = z.infer<typeof characterSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type CustomEvent = z.infer<typeof eventSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Collection =
  "characters" | "events" | "tasks" | "recommendations" | "settings";
export type RecordData =
  Character | CustomEvent | Task | Recommendation | Settings;
export type Data = {
  characters: Character[];
  events: CustomEvent[];
  tasks: Task[];
  recommendations: Recommendation[];
  settings: Settings;
};
export type Operation = {
  collection: Collection;
  action: "put" | "delete";
  record?: RecordData;
  id?: string;
};
export type Change = {
  collection: Collection;
  id: string;
  before: RecordData | null;
  after: RecordData | null;
};
export type Log = {
  id: string;
  createdAt: string;
  summary: string;
  changes: Change[];
  undone: boolean;
};
export type Chat = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
export const defaults: Settings = {
  id: "main",
  reminderDays: 14,
  defaultView: "home",
  timezone: "Asia/Shanghai",
  extraHolidays: true,
  solarTerms: true,
  excludedHolidays: [],
  theme: "system",
};
export const stamp = () => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
};
export const newPreset = (positive = "", name = "默认"): Preset => ({
  id: crypto.randomUUID(),
  name,
  positive,
  negative: "",
  model: "",
  notes: "",
});
export const newCharacter = (name = "", positive = ""): Character => {
  const p = newPreset(positive);
  return {
    ...stamp(),
    name,
    aliases: [],
    works: [],
    avatarUrl: "",
    bangumiId: null,
    anilistId: null,
    birthday: null,
    birthdaySource: "",
    birthdayFetchedAt: "",
    birthdayConfidence: "unknown",
    reminderDays: null,
    presets: [p],
    defaultPresetId: p.id,
    notes: "",
    starred: false,
    traits: "",
    chatGreeting: "",
    chatPersonality: "",
    chatExamples: "",
    avatarX: 50,
    avatarY: 18,
    avatarZoom: 1,
  };
};
export const compose = (...parts: string[]) =>
  parts.filter((p) => p.trim().length > 0).join(", ");
export const active = <T extends { deletedAt?: string | null }>(records: T[]) =>
  records.filter((r) => !r.deletedAt);
