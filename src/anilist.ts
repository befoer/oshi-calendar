import { z } from "zod";
import type { Character } from "./domain";
import {
  fetchBangumiCharacter,
  searchBangumi,
  detailBangumi,
  matchCharacterCandidate,
  type BangumiCharacter,
} from "./bangumi";
import { newCharacter } from "./domain";
import { externalJSON } from "./external-network";

const characterFields = `id name { full native alternative } image { large medium } dateOfBirth { year month day } media(perPage: 10) { nodes { title { romaji english native } } }`;
const aniSchema = z.object({
  id: z.number().int().positive(),
  name: z.object({
    full: z.string().nullable(),
    native: z.string().nullable(),
    alternative: z.array(z.string()).nullable().optional(),
  }),
  image: z
    .object({ large: z.string().nullable(), medium: z.string().nullable() })
    .nullable()
    .optional(),
  dateOfBirth: z
    .object({
      year: z.number().int().nullable(),
      month: z.number().int().nullable(),
      day: z.number().int().nullable(),
    })
    .nullable()
    .optional(),
  media: z
    .object({
      nodes: z.array(
        z
          .object({
            title: z.object({
              romaji: z.string().nullable(),
              english: z.string().nullable(),
              native: z.string().nullable(),
            }),
          })
          .nullable(),
      ),
    })
    .nullable()
    .optional(),
});
async function queryAniList(query: string, variables: Record<string, unknown>) {
  const response = await externalJSON("AniList", "https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.errors?.length)
    throw new Error(
      `AniList：${response.errors.map((e: { message?: string }) => e.message || "查询失败").join("；")}`,
    );
  if (!response.data) throw new Error("AniList 未返回角色资料");
  return response.data;
}
export function normalizeAniList(input: unknown): BangumiCharacter {
  const c = aniSchema.parse(input);
  const birthday = c.dateOfBirth;
  const raw =
    birthday?.month && birthday.day
      ? `${birthday.month}月${birthday.day}日`
      : birthday?.year
        ? `${birthday.year}年（无月日）`
        : "";
  return {
    id: c.id,
    provider: "anilist",
    name: c.name.full || c.name.native || `AniList ${c.id}`,
    birth_mon: birthday?.month ?? undefined,
    birth_day: birthday?.day ?? undefined,
    images: { medium: c.image?.large || c.image?.medium || "" },
    infobox: [
      { key: "简体中文名", value: c.name.native || c.name.full || "" },
      {
        key: "别名",
        value: [c.name.full, c.name.native, ...(c.name.alternative ?? [])]
          .filter((v): v is string => !!v)
          .map((v) => ({ v })),
      },
      { key: "生日", value: raw },
    ],
    works: [
      ...new Set(
        (c.media?.nodes ?? [])
          .flatMap((m) => [m?.title.romaji, m?.title.english, m?.title.native])
          .filter((v): v is string => !!v),
      ),
    ],
  };
}
export async function fetchAniListCharacter(id: number) {
  const data = await queryAniList(
    `query($id: Int!) { Character(id: $id) { ${characterFields} } }`,
    { id },
  );
  const result = normalizeAniList(data.Character);
  if (result.id !== id) throw new Error("AniList 返回的角色 ID 不匹配");
  return result;
}
export async function searchAniList(
  query: string,
  character?: Character,
  bangumi?: BangumiCharacter,
): Promise<BangumiCharacter[]> {
  const id = query.match(/(?:character\/|^)(\d+)(?:[/?#].*)?$/)?.[1];
  if (id) return [await fetchAniListCharacter(Number(id))];
  return (await searchAniListLookup(query, character, bangumi)).results;
}
export async function searchAniListLookup(
  query: string,
  character?: Character,
  bangumi?: BangumiCharacter,
) {
  const resolved = await resolveAniListName(query, character, bangumi);
  return { ...resolved, results: await searchAniListName(resolved.name) };
}
async function searchAniListName(name: string): Promise<BangumiCharacter[]> {
  const data = await queryAniList(
    `query($search: String!) { Page(perPage: 10) { characters(search: $search) { ${characterFields} } } }`,
    { search: name },
  );
  return z
    .array(z.unknown())
    .parse(data.Page?.characters)
    .map(normalizeAniList);
}
const isEnglishName = (value: string) =>
  /[a-z]/i.test(value) &&
  !/[\u3400-\u9fff\u3040-\u30ff]/u.test(value) &&
  !/[,\\]|:\s*\d|\([^)]*\d/.test(value) &&
  value.trim().length > 1;
export function bangumiEnglishName(character: BangumiCharacter) {
  const aliases =
    character.infobox?.filter((field) =>
      /英文|英语|英語|english|罗马|羅馬|roman/i.test(field.key),
    ) ?? [];
  const labelled = aliases.flatMap((field) =>
    typeof field.value === "string"
      ? [field.value]
      : field.value.map((alias) => alias.v),
  );
  const general = character.infobox?.find(
    (field) => field.key === "别名",
  )?.value;
  const preferred = Array.isArray(general)
    ? general
        .filter((alias) =>
          /英文|英语|英語|english|罗马|羅馬|roman/i.test(alias.k ?? ""),
        )
        .map((alias) => alias.v)
    : [];
  const rest =
    typeof general === "string"
      ? [general]
      : (general?.map((alias) => alias.v) ?? []);
  return [...labelled, ...preferred, character.name, ...rest]
    .find(isEnglishName)
    ?.trim();
}
export async function resolveAniListName(
  query: string,
  character?: Character,
  remote?: BangumiCharacter,
) {
  let bangumi = remote?.provider !== "anilist" ? remote : undefined;
  let failure: unknown;
  if (!bangumi) {
    try {
      if (character?.bangumiId)
        bangumi = await fetchBangumiCharacter(character.bangumiId);
      else {
        const results = await searchBangumi(query);
        const detailed = await Promise.all(
          results.map((candidate) => detailBangumi(candidate.id)),
        );
        const selected = matchCharacterCandidate(
          character ?? newCharacter(query),
          detailed,
        );
        if (selected) bangumi = selected;
        else if (results.length)
          throw new Error(
            "Bangumi 返回多个或身份不匹配的角色，请先选择正确角色，避免使用错误英文名",
          );
      }
    } catch (error) {
      failure = error;
    }
  }
  const fromBangumi = bangumi && bangumiEnglishName(bangumi);
  if (fromBangumi) return { name: fromBangumi, bangumi };
  if (failure instanceof Error && /多个或身份不匹配/.test(failure.message))
    throw failure;
  const known = character?.bangumiId
    ? knownLookups.get(character.bangumiId)?.name
    : undefined;
  const cached = [
    known,
    ...(character?.aliases ?? []),
    character?.name,
    query,
  ].find((name): name is string => !!name && isEnglishName(name));
  if (cached) return { name: cached.trim(), bangumi };
  throw new Error(
    `未取得角色英文名，无法搜索 AniList。请先关联 Bangumi 或填写英文名称${failure instanceof Error ? `；${failure.message}` : ""}`,
  );
}
const knownLookups = new Map<number, { name: string; works: string[] }>([
  [46465, { name: "Roxy Migurdia", works: ["mushoku tensei", "無職転生"] }],
  [35616, { name: "Beatrice", works: ["re:zero", "Re：ゼロ"] }],
  [
    51006,
    {
      name: "Chtholly Nota Seniorious",
      works: ["shuumatsu nani", "worldend", "終末なに"],
    },
  ],
]);
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");
export function matchAniList(
  character: Character,
  candidates: BangumiCharacter[],
) {
  const lookup = character.bangumiId
    ? knownLookups.get(character.bangumiId)
    : undefined;
  const names = [lookup?.name, character.name, ...character.aliases]
    .filter((v): v is string => !!v)
    .map(normalize);
  const works = (lookup?.works ?? character.works).map(normalize);
  const matched = candidates.filter((candidate) => {
    const aliases = candidate.infobox?.find((i) => i.key === "别名")?.value;
    const externalNames = [
      candidate.name,
      ...(Array.isArray(aliases) ? aliases.map((v) => v.v) : []),
    ].map(normalize);
    return (
      externalNames.some((n) => names.includes(n)) &&
      works.some(
        (w) =>
          w.length > 2 &&
          candidate.works?.some((work) => normalize(work).includes(w)),
      )
    );
  });
  return matched.length === 1 ? matched[0] : null;
}
export async function findAniListFallback(
  character: Character,
  bangumi?: BangumiCharacter,
) {
  if (character.anilistId) return fetchAniListCharacter(character.anilistId);
  const lookup = character.bangumiId
    ? knownLookups.get(character.bangumiId)
    : undefined;
  const resolved = await resolveAniListName(character.name, character, bangumi);
  const candidates = await searchAniListName(resolved.name);
  const remoteAliases = resolved.bangumi?.infobox?.find(
    (field) => field.key === "别名",
  )?.value;
  const identity = {
    ...character,
    aliases: [
      ...character.aliases,
      resolved.name,
      resolved.bangumi?.name ?? "",
      ...(Array.isArray(remoteAliases)
        ? remoteAliases.map((alias) => alias.v)
        : []),
    ],
    works: [
      ...character.works,
      ...(resolved.bangumi?.works ?? []),
      ...(lookup?.works ?? []),
    ],
  };
  return matchCharacterCandidate(identity, candidates);
}
