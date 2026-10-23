import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  CalendarDays,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import type { Character, Data } from "../domain";
import { daysToBirthday, sortCharacters } from "../character-sort";
import { SelectMenu } from "../select-menu";
import { AcgDnaMark } from "../acg-dna-mark";
import {
  Avatar,
  Empty,
  PageHeader,
  StarButton,
  missingBirthdayLabel,
  needsBirthday,
} from "../ui";

export function Characters({
  data,
  onEdit,
  onAdd,
  onCopyTag,
  onStar,
  onChat,
  onExportAcg,
  exportingAcg,
}: {
  data: Data;
  onEdit: (c: Character) => void;
  onAdd: () => void;
  onCopyTag: (characterId?: string) => Promise<boolean>;
  onStar: (c: Character) => void;
  onChat: (c: Character) => void;
  onExportAcg: (characters: Character[]) => void;
  exportingAcg: boolean;
}) {
  const [copied, setCopied] = useState("");
  const copyTag = async (c: Character) => {
    if (await onCopyTag(c.id)) {
      setCopied(c.id);
      setTimeout(() => setCopied(""), 1800);
    }
  };
  const [query, setQuery] = useState(""),
    [work, setWork] = useState(""),
    [sort, setSort] = useState("birthday"),
    [onlyUnknown, setOnlyUnknown] = useState(false),
    [onlyStarred, setOnlyStarred] = useState(false);
  const works = useMemo(
    () => [...new Set(data.characters.flatMap((c) => c.works))],
    [data.characters],
  );
  const filtered = useMemo(() => {
    const list = data.characters.filter(
      (c) =>
        (!query ||
          [c.name, ...c.aliases, ...c.works].some((s) =>
            s.toLowerCase().includes(query.toLowerCase()),
          )) &&
        (!work || c.works.includes(work)) &&
        (!onlyUnknown || needsBirthday(c)) &&
        (!onlyStarred || c.starred),
    );
    return sortCharacters(list, sort);
  }, [data.characters, query, work, onlyUnknown, onlyStarred, sort]);
  const pending = data.characters.filter(needsBirthday).length;
  const starred = data.characters.filter((c) => c.starred).length;
  return (
    <>
      <PageHeader
        eyebrow="CHARACTER LIBRARY"
        title="角色库"
        actions={
          <>
            <button
              onClick={() => onExportAcg(filtered)}
              disabled={!filtered.length || exportingAcg}
              title="把当前列表里的角色（名字、作品、头像）导入到次元属性"
            >
              {exportingAcg ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <AcgDnaMark size={16} />
              )}
              导入次元属性
            </button>
            <button className="primary" onClick={onAdd}>
              <Plus size={17} />
              添加角色
            </button>
          </>
        }
      >
        {data.characters.length} 位角色 · {starred} 位标星 · {pending}{" "}
        位生日待确认 · {works.length} 部作品
      </PageHeader>
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            placeholder="搜索角色、别名或作品"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="check-label chip-check">
          <input
            type="checkbox"
            checked={onlyStarred}
            onChange={(e) => setOnlyStarred(e.target.checked)}
          />
          <Star size={15} />
          仅标星
        </label>
        <label className="check-label chip-check">
          <input
            type="checkbox"
            checked={onlyUnknown}
            onChange={(e) => setOnlyUnknown(e.target.checked)}
          />
          生日待确认
        </label>
        <SelectMenu
          label="角色排序"
          icon={<SlidersHorizontal size={15} />}
          value={sort}
          onChange={setSort}
          options={[
            { value: "birthday", label: "生日临近" },
            { value: "default", label: "添加顺序（最新在前）" },
            { value: "starred", label: "标星优先" },
            { value: "name", label: "名称" },
          ]}
        />
      </div>
      {works.length > 1 && (
        <div className="chip-row" role="group" aria-label="按作品筛选">
          <button
            className={work === "" ? "selected" : ""}
            aria-pressed={work === ""}
            onClick={() => setWork("")}
          >
            全部作品
          </button>
          {works.map((w) => (
            <button
              key={w}
              className={work === w ? "selected" : ""}
              aria-pressed={work === w}
              onClick={() => setWork(work === w ? "" : w)}
            >
              {w}
            </button>
          ))}
        </div>
      )}
      <div className="characters-grid">
        {filtered.map((c) => {
          const days = daysToBirthday(c);
          return (
            <article className="character-card" key={c.id}>
              <div className="cover-wrap">
                <button className="character-cover" onClick={() => onEdit(c)}>
                  <Avatar character={c} size="cover" />
                  {days !== null && (
                    <span className={`cc-soon${days === 0 ? " today" : ""}`}>
                      {days === 0 ? "今天生日" : `${days} 天后`}
                    </span>
                  )}
                </button>
                <StarButton
                  className="card-star"
                  starred={c.starred}
                  name={c.name}
                  onToggle={() => onStar(c)}
                />
              </div>
              <div className="character-info">
                <div
                  className={`cover-date birthday-label ${c.birthdayConfidence}`}
                >
                  <CalendarDays size={14} />
                  <span>
                    {c.birthdayConfidence === "confirmed" && c.birthday
                      ? `${c.birthday.month} / ${c.birthday.day}`
                      : missingBirthdayLabel(c)}
                  </span>
                </div>
                <h3>
                  <button className="text-button" onClick={() => onEdit(c)}>
                    {c.name}
                  </button>
                </h3>
                <p>{c.works[0] || "未填写作品"}</p>
                <div className="character-meta">
                  <button
                    className={`copy-tag${copied === c.id ? " done" : ""}`}
                    aria-label={`复制 Tag · ${c.name}`}
                    onClick={() => void copyTag(c)}
                  >
                    {copied === c.id ? <Check size={16} /> : <Copy size={16} />}
                    {copied === c.id ? "已复制" : "复制 Tag"}
                  </button>
                  <button
                    className="ai-chip"
                    title={`和 ${c.name} 聊天`}
                    aria-label={`和 ${c.name} 聊天`}
                    onClick={() => onChat(c)}
                  >
                    AI
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <Empty>
          {onlyStarred ? "还没有标星的角色，点卡片右上角的星标试试" : "没有符合条件的角色"}
        </Empty>
      )}
    </>
  );
}
