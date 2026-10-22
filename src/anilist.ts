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
async function queryAniList(
  query: string,
  variables: Record<string, unknown>,
  quiet = false,
) {
  const response = await externalJSON(
    "AniList",
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    },
    { quiet },
  );
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
export async function fetchAniListCharacter(id: number, quiet = false) {
  const data = await queryAniList(
    `query($id: Int!) { Character(id: $id) { ${characterFields} } }`,
    { id },
    quiet,
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
async function searchAniListName(
  name: string,
  quiet = false,
): Promise<BangumiCharacter[]> {
  const data = await queryAniList(
    `query($search: String!) { Page(perPage: 10) { characters(search: $search) { ${characterFields} } } }`,
    { search: name },
    quiet,
  );
  return z
    .array(z.unknown())
    .parse(data.Page?.characters)
    .map(normalizeAniList);
}
const sameName = (a: string, b: string) =>
  a.normalize("NFKC").replace(/s+/g, "") === b.normalize("NFKC").replace(/s+/g, "");
/**
 * 用日文原名在 AniList 上查英文名（AniList 能按日文名搜到角色，如 コロンビア → Columbia）。
 * 只接受原名完全一致的结果，查不到或失败都返回 null，不弹网络提示。
 */
export async function anilistEnglishName(
  native: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!native.trim() || native.length > 100) return null;
  try {
    const data = await externalJSON(
      "AniList",
      "https://graphql.anilist.co",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: `query($search: String!) { Page(perPage: 10) { characters(search: $search) { id name { full native } } } }`,
          variables: { search: native.trim() },
        }),
        signal,
      },
      { quiet: true },
    );
    const list = (data?.data?.Page?.characters ?? []) as {
      name?: { full?: string | null; native?: string | null };
    }[];
    const hit = list.find(
      (c) => c.name?.native && sameName(c.name.native, native.trim()),
    );
    const full = hit?.name?.full?.trim();
    return full && isEnglishName(full) ? full : null;
  } catch {
    return null;
  }
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
  // 直接输入的英文名就是 AniList 要的，不必先绕 Bangumi（否则 Bangumi 重名会把搜索整个拦住）。
  // 已有 Bangumi 关联的角色（自动补生日）仍按 Bangumi 核对身份，不走这里。
  if (!character?.bangumiId && isEnglishName(query.trim()))
    return { name: query.trim(), bangumi: undefined as BangumiCharacter | undefined };
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
        else if (results.length) {
          // 不擅自挑一个英文名；但日文原名完全一致的 AniList 角色可以确定是谁
          if (!character) {
            const exact = await anilistEnglishName(query);
            if (exact) return { name: exact, bangumi: undefined };
          }
          throw new Error(
            "Bangumi 里有多个同名角色，无法确定英文名。请先在 Bangumi 里选好角色再切换过来，或直接输入英文名",
          );
        }
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
  // 后台补资料用的备用来源：AniList 出问题时不弹窗打扰（Bangumi 本身失败仍会提示）
  if (character.anilistId) return fetchAniListCharacter(character.anilistId, true);
  const lookup = character.bangumiId
    ? knownLookups.get(character.bangumiId)
    : undefined;
  const resolved = await resolveAniListName(character.name, character, bangumi);
  const candidates = await searchAniListName(resolved.name, true);
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
