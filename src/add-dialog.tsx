import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  ChevronDown,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import {
  searchBangumi,
  detailBangumi,
  bgmName,
  birthdayCandidate,
  mergeBangumi,
  characterSourceURL,
  fetchBangumiWorks,
  type BangumiCharacter,
} from "./bangumi";
import {
  searchAniList,
  searchAniListLookup,
  bangumiEnglishName,
} from "./anilist";
import {
  newCharacter,
  type Character,
  type CustomEvent,
  type Data,
} from "./domain";
import { put } from "./store";
import { Avatar, ErrorText, Modal } from "./ui";
import { EventForm, defaultTag, withTag } from "./editors";
import { TagField, type TagValue } from "./tag-field";
import { AvatarCandidates } from "./avatar-candidates";
import {
  getBangumiConnection,
  setBangumiConnection,
  useBangumiConnection,
  type BangumiConnection,
} from "./bangumi-connection";

export type AddTab = "event" | "character";

/** 首页「添加日程」与角色库「添加角色」共用的窗口：自定义节日 / 角色两个分页。 */
export function AddDialog({
  initialTab,
  event,
  data,
  onClose,
  onEventSaved,
  onSaved,
  onManual,
}: {
  initialTab: AddTab;
  event: CustomEvent;
  data: Data;
  onClose: () => void;
  onEventSaved: () => void;
  onSaved: (c: Character, added: boolean) => void;
  onManual: (name: string) => void;
}) {
  const [tab, setTab] = useState<AddTab>(initialTab);
  return (
    <Modal
      title={tab === "event" ? "添加自定义节日" : "添加角色"}
      onClose={onClose}
      className="add-dialog"
    >
      <div className="add-tabs" role="tablist" aria-label="添加类型">
        <button
          role="tab"
          aria-selected={tab === "character"}
          className={tab === "character" ? "selected" : ""}
          onClick={() => setTab("character")}
        >
          <UserPlus size={16} />
          角色
        </button>
        <button
          role="tab"
          aria-selected={tab === "event"}
          className={tab === "event" ? "selected" : ""}
          onClick={() => setTab("event")}
        >
          <CalendarPlus size={16} />
          自定义节日
        </button>
      </div>
      {tab === "event" ? (
        <EventForm
          event={event}
          onClose={onClose}
          onSaved={onEventSaved}
          embedded
        />
      ) : (
        <CharacterSearch
          target="new"
          data={data}
          onClose={onClose}
          onSaved={onSaved}
          onManual={onManual}
        />
      )}
    </Modal>
  );
}

const sameCharacter = (a: BangumiCharacter, b: BangumiCharacter) =>
  a.id === b.id && a.provider === b.provider;

/** 在线搜索角色：点击结果后，资料预览（头像、生日、Tag）直接展开在该结果里。 */
/** 搜索结果底部的小提示：用一组对照例子说明怎样搜得到。 */
const searchHints = {
  bangumi: {
    text: "找不到？试试搜全名或日文，例如：",
    examples: [
      { q: "小春", ok: false },
      { q: "下江小春", ok: true },
      { q: "コハル", ok: true },
    ],
  },
  anilist: {
    text: "找不到？AniList 只认英文全名，例如：",
    examples: [
      { q: "小春", ok: false },
      { q: "Koharu Shimoe", ok: true },
      { q: "Koharu", ok: true },
    ],
  },
} as const;
function SearchHint({ provider }: { provider: "bangumi" | "anilist" }) {
  const hint = searchHints[provider];
  return (
    <p className="search-hint">
      {hint.text}
      {hint.examples.map((e) => (
        <span
          key={e.q}
          className={`hint-chip${e.ok ? " ok" : " bad"}`}
          aria-label={`${e.q}：${e.ok ? "能搜到" : "常常搜不到"}`}
        >
          {e.q}
          {e.ok ? <Check size={12} /> : <X size={12} />}
        </span>
      ))}
    </p>
  );
}

export function CharacterSearch({
  target,
  initialResults,
  data,
  onClose,
  onSaved,
  onManual,
  onProvider,
}: {
  target: Character | "new";
  initialResults?: BangumiCharacter[];
  data: Data;
  onClose: () => void;
  onSaved: (c: Character, added: boolean) => void;
  onManual?: (name: string) => void;
  onProvider?: (provider: "bangumi" | "anilist") => void;
}) {
  const [provider, setProvider] = useState<"bangumi" | "anilist">(
    initialResults?.[0]?.provider === "anilist" ||
      (target !== "new" && !target.bangumiId && target.anilistId)
      ? "anilist"
      : "bangumi",
  );
  const connection = useBangumiConnection();
  const searchSeq = useRef(0);
  const chooseSeq = useRef(0);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [query, setQuery] = useState(
      target === "new"
        ? ""
        : target.bangumiId
          ? String(target.bangumiId)
          : target.anilistId
            ? String(target.anilistId)
            : target.name,
    ),
    [results, setResults] = useState<BangumiCharacter[]>(initialResults ?? []),
    [selected, setSelected] = useState<BangumiCharacter | null>(null),
    [fields, setFields] = useState({
      avatar: true,
      aliases: true,
      works: true,
      birthday: false,
      tag: true,
      traits: true,
    }),
    [tagValue, setTagValue] = useState<TagValue>({ tag: "", traits: "" }),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false);
  useEffect(() => onProvider?.(provider), [provider, onProvider]);
  const existingTag = target !== "new" ? defaultTag(target) : "";
  const existingTraits = target !== "new" ? target.traits : "";
  const search = async (
    text = query,
    source: "bangumi" | "anilist" = provider,
  ) => {
    const provider = source;
    const query = text;
    if (!query.trim()) return;
    const seq = ++searchSeq.current;
    chooseSeq.current++;
    setLoading(true);
    setError("");
    setSelected(null);
    setOpening(null);
    setWorksLoading(false);
    try {
      try {
        if (
          provider === "anilist" &&
          !/(?:character\/|^)\d+(?:[/?#].*)?$/.test(query.trim())
        ) {
          const resolved = await searchAniListLookup(
            query.trim(),
            target === "new" ? undefined : target,
            selected?.provider !== "anilist"
              ? (selected ?? undefined)
              : undefined,
          );
          if (seq !== searchSeq.current) return;
          setQuery(resolved.name);
          setResults(resolved.results);
        } else {
          const results = await (provider === "anilist"
            ? searchAniList(query.trim())
            : searchBangumi(query.trim()));
          if (seq !== searchSeq.current) return;
          setResults(results);
        }
      } catch (failure) {
        if (seq !== searchSeq.current) return;
        if (
          provider === "anilist" ||
          getBangumiConnection() === "direct" ||
          /(?:character\/|^)\d+(?:[/?#].*)?$/.test(query.trim())
        )
          throw failure;
        setProvider("anilist");
        const resolved = await searchAniListLookup(
          query.trim(),
          target === "new" ? undefined : target,
        );
        if (seq !== searchSeq.current) return;
        setQuery(resolved.name);
        setResults(resolved.results);
      }
    } catch (e) {
      if (seq === searchSeq.current)
        setError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      if (seq === searchSeq.current) {
        setLoading(false);
        setSearched(true);
      }
    }
  };
  const searchedOnOpen = useRef(false);
  useEffect(() => {
    if (target === "new" || initialResults || searchedOnOpen.current) return;
    searchedOnOpen.current = true;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 搜索结果里已有名称、头像、生日等资料：点选后立刻展开预览，
  // 只有 Bangumi 的「出现作品」需要再请求一次，到了再补上（不再整页等待）。
  const [opening, setOpening] = useState<string | null>(null);
  const [worksLoading, setWorksLoading] = useState(false);
  useEffect(
    () => () => {
      searchSeq.current++;
      chooseSeq.current++;
      searchedOnOpen.current = false;
    },
    [],
  );
  const switchConnection = (next: BangumiConnection) => {
    searchSeq.current++;
    chooseSeq.current++;
    setBangumiConnection(next);
    setProvider("bangumi");
    setSelected(null);
    setResults([]);
    setOpening(null);
    setWorksLoading(false);
    setLoading(false);
    setError("");
    if (query.trim()) void search(query, "bangumi");
  };
  const show = (detail: BangumiCharacter) => {
    const b = birthdayCandidate(detail);
    setTagValue({ tag: "", traits: "" });
    setSelected(detail);
    setSelectedAvatar(null);
    setFields((v) => ({
      ...v,
      birthday:
        b.valid &&
        !b.conflict &&
        (target === "new" ||
          (!target.birthday && target.birthdayConfidence !== "none")),
      // 已有手动 Tag / 人物特征默认不被覆盖
      tag: !existingTag,
      traits: !existingTraits,
    }));
  };
  const choose = async (r: BangumiCharacter) => {
    if (selected && sameCharacter(selected, r)) {
      chooseSeq.current++;
      setSelected(null);
      setWorksLoading(false);
      return;
    }
    const seq = ++chooseSeq.current;
    setError("");
    setWorksLoading(false);
    try {
      if (r.provider === "anilist") {
        // AniList 搜索结果与详情字段相同，无需再请求
        setOpening(null);
        show(r);
        return;
      }
      if (r.infobox) {
        show({ ...r, works: undefined });
        setWorksLoading(true);
        const works = await fetchBangumiWorks(r.id);
        if (seq !== chooseSeq.current) return;
        setSelected((cur) =>
          cur && sameCharacter(cur, r) ? { ...cur, works } : cur,
        );
        setWorksLoading(false);
        return;
      }
      setOpening(`${r.provider ?? "bgm"}-${r.id}`);
      const detail = await detailBangumi(r.id);
      if (seq !== chooseSeq.current) return;
      show(detail);
    } catch (e) {
      if (seq === chooseSeq.current) {
        setSelected(null);
        setWorksLoading(false);
        setError(e instanceof Error ? e.message : "读取资料失败");
      }
    } finally {
      if (seq === chooseSeq.current) setOpening(null);
    }
  };
  // 确认关联：合并资料后直接保存，不再打开编辑器
  const confirm = async () => {
    if (!selected || saving) return;
    const current = target !== "new" ? target : newCharacter(bgmName(selected));
    const merged = mergeBangumi(current, selected, fields.birthday);
    let result: Character = {
      ...merged,
      avatarUrl: fields.avatar
        ? (selectedAvatar ?? merged.avatarUrl)
        : current.avatarUrl,
      aliases: fields.aliases ? merged.aliases : current.aliases,
      works: fields.works ? merged.works : current.works,
    };
    if (fields.tag && tagValue.tag.trim())
      result = withTag(result, tagValue.tag.trim());
    if (fields.traits && tagValue.traits.trim())
      result = { ...result, traits: tagValue.traits.trim() };
    setSaving(true);
    setError("");
    try {
      const added =
        target === "new" && !data.characters.some((c) => c.id === result.id);
      await put(
        "characters",
        result,
        `${added ? "添加角色" : "关联资料"}：${result.name}`,
      );
      onSaved(result, added);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  };
  const fieldLabels = {
    avatar: "采用头像",
    aliases: "合并别名",
    works: "合并作品",
    birthday: "已核实，采用生日月日",
    tag: existingTag ? "用新 Tag 替换已有 Tag" : "采用 Tag",
    traits: existingTraits ? "用新特征替换已有人物特征" : "采用人物特征",
  } as const;
  const switchProvider = (next: "bangumi" | "anilist") => {
    searchSeq.current++;
    chooseSeq.current++;
    setLoading(false);
    setWorksLoading(false);
    setOpening(null);

    // AniList 只能用英文名搜：从 Bangumi 切过来时，直接用 Bangumi 已选角色（或唯一结果）的英文名
    const from = selected ?? (results.length === 1 ? results[0] : null);
    const english =
      next === "anilist" && from && from.provider !== "anilist"
        ? bangumiEnglishName(from)
        : undefined;
    setProvider(next);
    setResults([]);
    setSelected(null);
    setError("");
    const text = english ?? (target === "new" ? "" : target.name);
    setQuery(text);
    if (english) void search(english, next);
  };
  const tagTerms = (c: BangumiCharacter) => [
    bangumiEnglishName(c) ?? "",
    c.provider === "anilist" ? c.name : "",
    bgmName(c),
    c.provider === "anilist" ? "" : c.name,
  ];
  return (
    <>
      <div className="modal-body">
        <div className="character-source-field">
          <span className="character-source-label">资料来源</span>
          <div
            className="character-source-slider"
            role="group"
            aria-label="角色资料来源"
            data-provider={provider}
          >
            {(["bangumi", "anilist"] as const).map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={provider === source}
                onClick={() => source !== provider && switchProvider(source)}
              >
                {source === "bangumi" ? "Bangumi" : "AniList"}
              </button>
            ))}
          </div>
        </div>
        <div className="search-field large">
          <Search size={18} />
          <input
            autoFocus
            placeholder={
              provider === "anilist"
                ? "输入英文角色名、AniList ID 或链接"
                : "输入角色名、Bangumi ID 或链接"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
          <button onClick={() => void search()} disabled={loading}>
            {loading && !results.length ? (
              <Loader2 className="spin" size={17} />
            ) : (
              "搜索"
            )}
          </button>
        </div>
        <ErrorText error={error} />
        {!loading && !error && searched && !results.length && (
          <p className="muted">没有找到对应角色。</p>
        )}
        {results.length > 0 && (
          <div className="bangumi-results">
            {results.map((r) => {
              const b = birthdayCandidate(r);
              const open = !!selected && sameCharacter(selected, r);
              return (
                <div
                  className={`result-item${open ? " open" : ""}`}
                  key={`${r.provider ?? "bgm"}-${r.id}`}
                >
                  <button
                    className="result-row"
                    disabled={loading}
                    aria-busy={opening === `${r.provider ?? "bgm"}-${r.id}`}
                    aria-expanded={open}
                    onClick={() => void choose(r)}
                  >
                    <Avatar
                      character={{
                        ...newCharacter(bgmName(r)),
                        avatarUrl: r.images?.medium || "",
                      }}
                    />
                    <div className="grow">
                      <strong>{bgmName(r)}</strong>
                      <span>
                        {r.name} ·{" "}
                        {b.month && b.day
                          ? `${b.month}月${b.day}日`
                          : "生日未提供"}
                      </span>
                    </div>
                    {opening === `${r.provider ?? "bgm"}-${r.id}` ? (
                      <Loader2 className="spin" size={17} />
                    ) : open ? (
                      <ChevronDown size={17} />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                  </button>
                  {open && selected && (
                    <div className="import-selection">
                      <div className="preview-head">
                        <div className="preview-avatars">
                          <button
                            type="button"
                            className="preview-original-avatar"
                            aria-label="使用原头像"
                            aria-pressed={selectedAvatar === null}
                            onClick={() => setSelectedAvatar(null)}
                            title="使用原头像"
                          >
                            <Avatar
                              character={{
                                ...newCharacter(bgmName(selected)),
                                avatarUrl:
                                  selected.images?.large ||
                                  selected.images?.medium ||
                                  "",
                              }}
                              size="preview"
                            />
                          </button>
                          {selected.provider !== "anilist" && (
                            <AvatarCandidates
                              key={selected.id}
                              character={selected}
                              value={selectedAvatar}
                              onChange={setSelectedAvatar}
                            />
                          )}
                        </div>
                        <div className="preview-info">
                          <h3>{bgmName(selected)} · 资料预览</h3>
                          <p>
                            {worksLoading
                              ? "正在读取出现作品…"
                              : selected.works?.join(" · ") || "作品信息未提供"}
                          </p>
                          <p>
                            生日原文：
                            {birthdayCandidate(selected).raw || "未提供"}
                            <br />
                            API 月日：{birthdayCandidate(selected).month ||
                              "?"}{" "}
                            / {birthdayCandidate(selected).day || "?"}
                          </p>
                          <a
                            href={characterSourceURL(selected)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            查看原条目
                            <ExternalLink size={13} />
                          </a>
                        </div>
                      </div>

                      {birthdayCandidate(selected).conflict && (
                        <p className="error">
                          资料存在冲突或虚构历法，请核实后再确认月日。
                        </p>
                      )}
                      <TagField
                        key={`${selected.provider ?? "bgm"}-${selected.id}`}
                        terms={tagTerms(selected)}
                        value={tagValue}
                        onChange={setTagValue}
                        autoStart
                      />
                      <div className="import-fields">
                        {(
                          [
                            "avatar",
                            "aliases",
                            "works",
                            "birthday",
                            "tag",
                            "traits",
                          ] as const
                        ).map((key) => (
                          <label className="check-label" key={key}>
                            <input
                              type="checkbox"
                              checked={fields[key]}
                              disabled={
                                (key === "birthday" &&
                                  (!birthdayCandidate(selected).month ||
                                    !birthdayCandidate(selected).day)) ||
                                (key === "tag" && !tagValue.tag.trim()) ||
                                (key === "traits" && !tagValue.traits.trim())
                              }
                              onChange={(e) =>
                                setFields({
                                  ...fields,
                                  [key]: e.target.checked,
                                })
                              }
                            />
                            {fieldLabels[key]}
                          </label>
                        ))}
                      </div>
                      <button
                        className="primary"
                        disabled={saving || worksLoading}
                        onClick={() => void confirm()}
                      >
                        <Check size={16} />
                        确认关联
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {searched && !loading && <SearchHint provider={provider} />}
      </div>
      <footer>
        <div className="footer-left">
          {target === "new" && onManual && (
            <button onClick={() => onManual(query.trim())}>
              <Plus size={16} />
              手动添加角色
            </button>
          )}
          <button
            className="bangumi-direct-toggle"
            type="button"
            role="switch"
            aria-checked={connection === "direct"}
            aria-label="直连 Bangumi"
            title={
              connection === "direct"
                ? "已启用直连，点击恢复网关"
                : "网关不可用时可开启直连"
            }
            onClick={() =>
              switchConnection(connection === "direct" ? "gateway" : "direct")
            }
          >
            <span className="connection-switch-track" aria-hidden="true">
              <span />
            </span>
            直连 Bangumi
          </button>
        </div>
        <div className="footer-right">
          <button onClick={onClose}>关闭</button>
          <button
            className="primary"
            disabled={!selected || saving || worksLoading}
            title={selected ? "" : "先在列表里点选一个角色"}
            onClick={() => void confirm()}
          >
            {saving ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            确认关联
          </button>
        </div>
      </footer>
    </>
  );
}

/** 已有角色关联资料（设置页「选择资料」、编辑器「获取头像和生日」）使用的独立窗口。 */
export function BangumiImport(props: {
  target: Character;
  initialResults?: BangumiCharacter[];
  data: Data;
  onClose: () => void;
  onSaved: (c: Character, added: boolean) => void;
}) {
  const [provider, setProvider] = useState<"bangumi" | "anilist">("bangumi");
  return (
    <Modal
      title={`从 ${provider === "anilist" ? "AniList" : "Bangumi"} 导入角色`}
      onClose={props.onClose}
      className="add-dialog"
    >
      <CharacterSearch {...props} onProvider={setProvider} />
    </Modal>
  );
}
