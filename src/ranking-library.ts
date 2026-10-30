import { newCharacter, type Character } from "./domain";
import { db, repository } from "./store";
import type { BirthdayRankingEntry } from "./birthday-ranking";

export function rankingCharacter(
  entry: BirthdayRankingEntry,
  characters: Character[],
) {
  return characters.find(
    (c) =>
      !c.deletedAt &&
      (c.anilistId === entry.id ||
        (!c.anilistId &&
          !!entry.work &&
          c.works.includes(entry.work) &&
          [c.name, ...c.aliases].includes(entry.name))),
  );
}

export async function addRankingCharacter(entry: BirthdayRankingEntry) {
  // Check and save in one transaction, including across open tabs.
  return db.transaction("rw", db.tables, async () => {
    const existing = rankingCharacter(entry, await db.characters.toArray());
    if (existing) return existing;
    const character: Character = {
      ...newCharacter(entry.name),
      anilistId: entry.id,
      avatarUrl: entry.avatarUrl,
      works: entry.work ? [entry.work] : [],
      birthday: { month: entry.month, day: entry.day },
      birthdayConfidence: "confirmed",
      birthdaySource: `https://anilist.co/character/${entry.id}`,
      birthdayFetchedAt: new Date().toISOString(),
    };
    await repository.apply(
      [{ collection: "characters", action: "put", record: character }],
      `添加今日寿星：${entry.name}`,
    );
    return character;
  });
}
