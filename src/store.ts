import Dexie, { type Table } from "dexie";
import { z } from "zod";
import {
  characterSchema,
  eventSchema,
  taskSchema,
  recommendationSchema,
  settingsSchema,
  defaults,
  stamp,
  type Character,
  type CustomEvent,
  type Task,
  type Recommendation,
  type Settings,
  type RecordData,
  type Operation,
  type Collection,
  type Log,
  type Chat,
  type Data,
  active,
} from "./domain";
import { birthdayFromSnapshot } from "./birthday-data";

class CalendarDB extends Dexie {
  characters!: Table<Character>;
  events!: Table<CustomEvent>;
  tasks!: Table<Task>;
  recommendations!: Table<Recommendation>;
  settings!: Table<Settings>;
  logs!: Table<Log>;
  chats!: Table<Chat>;
  assistantRuns!: Table<{ id: string; updatedAt: string; state: unknown }>;
  constructor() {
    super("huiqi-calendar");
    this.version(1).stores({
      characters: "id,name,bangumiId",
      events: "id,date",
      tasks: "id,date,status",
      recommendations: "id,dateStart",
      settings: "id",
      logs: "id,createdAt",
      chats: "id,createdAt",
    });
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("settings")
          .toCollection()
          .modify((s) => {
            s.theme ??= "system";
          });
        await tx
          .table("characters")
          .toCollection()
          .modify((c) => {
            c.birthdayFetchedAt ??= "";
          });
      });
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("characters")
          .toCollection()
          .modify((c) => {
            c.anilistId ??= null;
          });
      });
    this.version(4).stores({ assistantRuns: "id,updatedAt" });
    this.version(5)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("settings")
          .toCollection()
          .modify((s) => {
            s.excludedHolidays ??= [];
          });
      });
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("characters")
          .toCollection()
          .modify((c) => {
            c.starred ??= false;
          });
      });
    this.version(7)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("characters")
          .toCollection()
          .modify((c) => {
            c.traits ??= "";
          });
      });
    this.version(8)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("characters")
          .toCollection()
          .modify((c) => {
            c.avatarX ??= 50;
            c.avatarY ??= 18;
            c.avatarZoom ??= 1;
          });
      });
  }
}
export const db = new CalendarDB();
const collections: Collection[] = [
  "characters",
  "events",
  "tasks",
  "recommendations",
  "settings",
];
export const schemas = {
  characters: characterSchema,
  events: eventSchema,
  tasks: taskSchema,
  recommendations: recommendationSchema,
  settings: settingsSchema,
};
const operationSchema = z
  .object({
    collection: z.enum([
      "characters",
      "events",
      "tasks",
      "recommendations",
      "settings",
    ]),
    action: z.enum(["put", "delete"]),
    record: z.unknown().optional(),
    id: z.string().optional(),
  })
  .strict();
export interface Repository {
  snapshot(): Promise<Data>;
  apply(ops: Operation[], summary: string, id?: string): Promise<Log>;
  undo(id: string): Promise<void>;
}
export class LocalRepository implements Repository {
  async snapshot(): Promise<Data> {
    const [characters, events, tasks, recommendations, settings] =
      await Promise.all([
        db.characters.toArray(),
        db.events.toArray(),
        db.tasks.toArray(),
        db.recommendations.toArray(),
        db.settings.get("main"),
      ]);
    return {
      characters: active(characters).sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          Number(a.id.replace("seed-", "")) -
            Number(b.id.replace("seed-", "")) ||
          a.name.localeCompare(b.name),
      ),
      events: active(events),
      tasks: active(tasks),
      recommendations: active(recommendations),
      settings: { ...defaults, ...settings },
    };
  }
  async apply(
    input: Operation[],
    summary: string,
    requestId: string = crypto.randomUUID(),
    expected: { collection: string; id: string; value: string }[] = [],
  ): Promise<Log> {
    if (!input.length || input.length > 50)
      throw new Error("一次操作应包含 1–50 条记录");
    const ops = input.map((op) => {
      operationSchema.parse(op);
      if (op.action === "delete") {
        if (op.collection === "settings" || !op.id)
          throw new Error("删除对象无效");
        return op;
      }
      return {
        ...op,
        record: schemas[op.collection].parse(op.record) as RecordData,
      };
    });
    return db.transaction(
      "rw",
      [...collections.map((c) => db.table(c)), db.logs],
      async () => {
        const prior = await db.logs.get(requestId);
        if (prior) return prior;
        for (const e of expected)
          if (
            JSON.stringify(await db.table(e.collection).get(e.id)) !== e.value
          )
            throw new Error("资料在预览后已变化，请重新请求操作");
        const seen = new Set<string>();
        const changes: Log["changes"] = [];
        const now = new Date().toISOString();
        const projected = new Map(
          (await db.characters.toArray()).map((c) => [c.id, c]),
        );
        for (const op of ops)
          if (op.collection === "characters") {
            if (op.action === "put")
              projected.set(op.record!.id, op.record as Character);
            else projected.delete(op.id!);
          }
        const projectedReferences = [
          ...(await db.tasks.toArray()),
          ...(await db.recommendations.toArray()),
        ].filter(
          (r) =>
            !r.deletedAt &&
            !ops.some((op) => op.id === r.id || op.record?.id === r.id),
        );
        for (const r of projectedReferences)
          for (const cid of r.characterIds)
            if (!projected.has(cid) || projected.get(cid)?.deletedAt)
              throw new Error("角色仍关联创作任务或选题，请先移除关联后删除");
        for (const op of ops) {
          const id = op.action === "delete" ? op.id! : op.record!.id;
          const key = op.collection + ":" + id;
          if (seen.has(key)) throw new Error("同一批次不能重复修改同一记录");
          seen.add(key);
          const before = (await db.table(op.collection).get(id)) as
            RecordData | undefined;
          if (
            op.action === "delete" &&
            (!before || ("deletedAt" in before && before.deletedAt))
          )
            throw new Error("记录已不存在");
          let after: RecordData;
          if (op.action === "delete")
            after = {
              ...before!,
              deletedAt: now,
              updatedAt: now,
            } as RecordData;
          else
            after =
              op.collection === "settings"
                ? op.record!
                : ({
                    ...op.record!,
                    createdAt:
                      before && "createdAt" in before
                        ? before.createdAt
                        : (op.record as Character).createdAt,
                    updatedAt: now,
                  } as RecordData);
          if (op.collection === "tasks" || op.collection === "recommendations")
            for (const cid of (after as Task).characterIds)
              if (!projected.has(cid) || projected.get(cid)?.deletedAt)
                throw new Error("引用的角色不存在");
          changes.push({
            collection: op.collection,
            id,
            before: before ?? null,
            after,
          });
        }
        // All validation precedes writes, and Dexie rolls back the entire batch on error.
        for (const change of changes)
          await db.table(change.collection).put(change.after!);
        const log: Log = {
          id: requestId,
          createdAt: now,
          summary,
          changes,
          undone: false,
        };
        await db.logs.add(log);
        return log;
      },
    );
  }
  async undo(id: string) {
    await db.transaction(
      "rw",
      [...collections.map((c) => db.table(c)), db.logs],
      async () => {
        const log = await db.logs.get(id);
        if (!log || log.undone) throw new Error("操作已撤销或不存在");
        for (const change of log.changes) {
          const current = await db.table(change.collection).get(change.id);
          if (JSON.stringify(current ?? null) !== JSON.stringify(change.after))
            throw new Error("记录已被后续修改，撤销会覆盖新内容；请手动调整");
        }
        const projected = new Map(
          (await db.characters.toArray())
            .filter((c) => !c.deletedAt)
            .map((c) => [c.id, c]),
        );
        for (const c of log.changes.filter(
          (c) => c.collection === "characters",
        )) {
          if (c.before && !(c.before as Character).deletedAt)
            projected.set(c.id, c.before as Character);
          else projected.delete(c.id);
        }
        const refs = new Map(
          [
            ...(await db.tasks.toArray()),
            ...(await db.recommendations.toArray()),
          ].map((r) => [r.id, r]),
        );
        for (const c of log.changes.filter(
          (c) => c.collection === "tasks" || c.collection === "recommendations",
        )) {
          if (c.before) refs.set(c.id, c.before as Task);
          else refs.delete(c.id);
        }
        for (const r of refs.values())
          if (!r.deletedAt && r.characterIds.some((id) => !projected.has(id)))
            throw new Error("后续任务或选题引用了此角色，无法撤销创建");
        for (const change of log.changes) {
          if (change.before)
            await db.table(change.collection).put(change.before);
          else await db.table(change.collection).delete(change.id);
        }
        await db.logs.update(id, { undone: true });
      },
    );
  }
}
export const repository = new LocalRepository();
let initialization: Promise<void> | null = null;
export function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    await db.transaction("rw", db.characters, db.settings, async () => {
      if (!(await db.settings.get("main"))) {
        await db.settings.add(defaults);
      }
    });
    await restoreBirthdaySnapshot();
  })().finally(() => {
    initialization = null;
  });
  return initialization;
}
export async function restoreBirthdaySnapshot() {
  const operations: Operation[] = [];
  const expected: { collection: string; id: string; value: string }[] = [];
  for (const current of (await repository.snapshot()).characters) {
    const next = birthdayFromSnapshot(current);
    if (!next) continue;
    operations.push({ collection: "characters", action: "put", record: next });
    expected.push({
      collection: "characters",
      id: current.id,
      value: JSON.stringify(current),
    });
  }
  for (let i = 0; i < operations.length; i += 50)
    await repository.apply(
      operations.slice(i, i + 50),
      "补齐已核对的生日资料",
      crypto.randomUUID(),
      expected.slice(i, i + 50),
    );
  return operations.length;
}
/**
 * 标星、头像本地化这类偏好型改动不进入操作记录（否则会刷屏），
 * 但要同步改写记录里的前后快照，避免后面“撤销”因记录已变化而被拒绝。
 * `avatarFrom` 给定时只在前后快照仍是同一个远程头像地址时才替换头像。
 */
export async function patchCharacter(
  id: string,
  patch: { starred?: boolean; avatarUrl?: string },
  avatarFrom?: string,
) {
  await db.transaction("rw", db.characters, db.logs, async () => {
    const current = await db.characters.get(id);
    if (!current) return;
    const touched = new Date().toISOString();
    const apply = <T extends Partial<Character>>(record: T, touch: boolean): T => ({
      ...record,
      ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
      ...(patch.avatarUrl !== undefined &&
      (avatarFrom === undefined || record.avatarUrl === avatarFrom)
        ? { avatarUrl: patch.avatarUrl }
        : {}),
      ...(touch ? { updatedAt: touched } : {}),
    });
    await db.characters.put(apply(current, true));
    for (const log of await db.logs.toArray()) {
      let changed = false;
      for (const change of log.changes)
        if (change.collection === "characters" && change.id === id) {
          if (change.before) {
            change.before = apply(change.before as Character, false);
            changed = true;
          }
          // “之后”快照必须与当前记录逐字一致，撤销才不会被当成后续修改拒绝
          if (change.after) {
            change.after = apply(change.after as Character, true);
            changed = true;
          }
        }
      if (changed) await db.logs.put(log);
    }
  });
}
export const put = (
  collection: Collection,
  record: RecordData,
  summary = "保存资料",
) => repository.apply([{ collection, action: "put", record }], summary);
const backupSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: z.string(),
    characters: z.array(characterSchema),
    events: z.array(eventSchema),
    tasks: z.array(taskSchema),
    recommendations: z.array(recommendationSchema),
    settings: settingsSchema,
  })
  .strict();
export async function exportBackup() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    ...(await repository.snapshot()),
  };
}
export function validateBackup(value: unknown) {
  const b = backupSchema.parse(value);
  for (const c of collections.filter((c) => c !== "settings")) {
    const records = b[c] as RecordData[];
    if (new Set(records.map((r) => r.id)).size !== records.length)
      throw new Error("备份含重复 ID");
  }
  const ids = new Set(
    b.characters.filter((c) => !c.deletedAt).map((c) => c.id),
  );
  for (const r of [...b.tasks, ...b.recommendations])
    for (const id of r.deletedAt ? [] : r.characterIds)
      if (!ids.has(id)) throw new Error("备份含不存在的角色引用");
  return b;
}
export async function importBackup(value: unknown) {
  const b = validateBackup(value);
  await db.transaction(
    "rw",
    collections.map((c) => db.table(c)),
    async () => {
      for (const c of collections) {
        if (c === "settings") await db.settings.put(b.settings);
        else await db.table(c).bulkPut(b[c]);
      }
    },
  );
}
export async function saveChat(role: Chat["role"], content: string) {
  await db.chats.add({ ...stamp(), role, content });
}
