import {
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { addDays, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  ArrowRight,
  Brush,
  CalendarClock,
  CalendarDays,
  CalendarHeart,
  CalendarPlus,
  Cake,
  Check,
  Copy,
  Flower2,
  Hourglass,
  Loader2,
  Minus,
  Plus,
  PlusCircle,
  Star,
  Users,
} from "lucide-react";
import type { Character, Data, Task } from "../domain";
import {
  today,
  localDate,
  dateKey,
  daysUntil,
  occurrences,
  holidayKey,
  isHolidayExcluded,
  upcomingHolidays,
  localRecommendations,
  type Occurrence,
} from "../calendar";
import {
  Avatar,
  AvatarStack,
  Empty,
  IconButton,
  Sparkle,
  StarButton,
  eventLabels,
  lunarLabel,
  needsBirthday,
  shortDate,
  statusLabels,
  typeIcons,
  type Page,
} from "../ui";
import { IdeaCard } from "./Ideas";
import { useBirthdayNote } from "../birthday-note";
import { heroNarration } from "../hero-copy";

/** 旁白里的「N 天后／明天／后天」用粉色标出来。 */
const highlight = (text: string) =>
  text
    .split(/(\d+ 天后|明天|后天)/)
    .map((part, i) =>
      i % 2 ? (
        <em key={i} className="hl">
          {part}
        </em>
      ) : (
        part
      ),
    );

const ROWS_KEY = "huiqi-home-birthday-rows";
const readRows = () => {
  try {
    const n = Number(localStorage.getItem(ROWS_KEY));
    return n >= 1 && n <= 3 ? n : 1;
  } catch {
    return 1;
  }
};

/** 按容器宽度计算一行能放几张卡片，使卡片正好铺满整行。 */
function useColumns(ref: RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const small = window.matchMedia("(max-width: 650px)").matches;
      const min = small ? 140 : 172;
      const gap = small ? 12 : 14;
      setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return cols;
}

export function Home({
  data,
  onCharacter,
  onCopyTag,
  onStar,
  onOccurrence,
  onEvent,
  onAdd,
  onChat,
  onNavigate,
  onTask,
  onStatus,
  onNewTask,
  onUpdateSettings,
}: {
  data: Data;
  onCharacter: (c: Character) => void;
  onCopyTag: (characterId?: string) => Promise<boolean>;
  onStar: (c: Character) => void;
  onOccurrence: (e: Occurrence) => void;
  onEvent: () => void;
  onAdd: () => void;
  onChat: (c: Character) => void;
  onNavigate: (p: Page) => void;
  onTask: (t: Task) => void;
  onStatus: (t: Task, s: Task["status"]) => void;
  onNewTask: (characterId?: string, date?: string, title?: string) => void;
  onUpdateSettings: (patch: Partial<Data["settings"]>) => void;
}) {
  const [rows, setRows] = useState(readRows);
  const [copied, setCopied] = useState("");
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [holidayFilter, setHolidayFilter] = useState("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const cols = useColumns(strip);
  const now = today();
  const yearAhead = occurrences(data, now, dateKey(addDays(localDate(now), 366)));
  // 一年内每位角色只取最近的一次生日（今天 + 366 天可能把同一天重复算进来）
  const seen = new Set<string>();
  const starredIds = new Set(
    data.characters.filter((c) => c.starred).map((c) => c.id),
  );
  const allBirthdays = yearAhead.filter((e) => {
    if (e.type !== "birthday" || seen.has(e.characterIds[0])) return false;
    seen.add(e.characterIds[0]);
    return true;
  });
  const nextBirthdays = onlyStarred
    ? allBirthdays.filter((e) => starredIds.has(e.characterIds[0]))
    : allBirthdays;
  const soon = allBirthdays.filter((e) => daysUntil(e.date) <= 30).length;
  const nextBirthday = allBirthdays[0];
  const spotlight = nextBirthday
    ? data.characters.find((c) => c.id === nextBirthday.characterIds[0])
    : undefined;
  // 卡片位置 = 列数 × 行数，最后一格留给「全年生日」；至少排满 4 格
  const rowCount = Math.max(rows, Math.ceil(4 / cols));
  const shown = nextBirthdays.slice(0, cols * rowCount - 1);
  const usedRows = Math.ceil((shown.length + 1) / cols);
  const lastSpan = usedRows * cols - shown.length;
  const confirmed = data.characters.filter(
    (c) => c.birthday && c.birthdayConfidence === "confirmed",
  ).length;
  const todayItems = yearAhead.filter((e) => e.date === now);
  const nameOf = (id: string) =>
    data.characters.find((c) => c.id === id)?.name ?? "";
  const laterBirthdays = allBirthdays.filter((e) => e.date > now);
  const nextHoliday = upcomingHolidays(data, now, "all", false, 1)[0];
  const narration = heroNarration({
    todayBirthdays: todayItems
      .filter((e) => e.type === "birthday")
      .map((e) => nameOf(e.characterIds[0]))
      .filter(Boolean),
    nextBirthday: laterBirthdays.length
      ? {
          days: daysUntil(laterBirthdays[0].date),
          names: laterBirthdays
            .filter((e) => e.date === laterBirthdays[0].date)
            .map((e) => nameOf(e.characterIds[0]))
            .filter(Boolean),
        }
      : undefined,
    monthOthers: laterBirthdays
      .filter(
        (e) =>
          daysUntil(e.date) <= 30 &&
          e.date !== laterBirthdays[0].date,
      )
      .map((e) => nameOf(e.characterIds[0]))
      .filter(Boolean),
    nextHoliday: nextHoliday && {
      title: nextHoliday.title,
      days: daysUntil(nextHoliday.date),
    },
  });
  const holidays = upcomingHolidays(data, now, holidayFilter, showExcluded);
  const toggleExcluded = (e: Occurrence) => {
    const key = holidayKey(e);
    const excluded = data.settings.excludedHolidays ?? [];
    onUpdateSettings({
      excludedHolidays: excluded.includes(key)
        ? excluded.filter((id) => id !== key)
        : [...excluded, key],
    });
  };
  const queue = data.tasks
    .filter((t) => t.status === "todo" || t.status === "doing")
    .sort(
      (a, b) =>
        Number(b.status === "doing") - Number(a.status === "doing") ||
        a.date.localeCompare(b.date),
    );
  const doing = data.tasks.filter((t) => t.status === "doing").length;
  const ideas = localRecommendations(data)
    .filter((r) => r.dateEnd >= now)
    .slice(0, 3);
  const date = localDate(now);
  const { note, refresh: refreshNote } = useBirthdayNote(
    spotlight,
    nextBirthday ? daysUntil(nextBirthday.date) : 0,
  );
  const chooseRows = (n: number) => {
    setRows(n);
    try {
      localStorage.setItem(ROWS_KEY, String(n));
    } catch {
      /* 仅是显示偏好，存不下也不影响使用 */
    }
  };
  const copyTag = async (c: Character) => {
    if (await onCopyTag(c.id)) {
      setCopied(c.id);
      setTimeout(() => setCopied(""), 1800);
    }
  };
  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <Sparkle size={30} className="h1" />
          <Sparkle size={16} className="h2" />
          <Sparkle size={22} className="h3" />
          <Sparkle size={12} className="h4" />
        </div>
        <div className="hero-main">
          <div className="hero-copy">
            <div
              className="tear-calendar"
              role="img"
              aria-label={format(date, "yyyy年M月d日 EEEE", { locale: zhCN })}
            >
              <div className="tc-top">
                {format(date, "M月")} · {format(date, "EEE", { locale: zhCN })}
              </div>
              <div className="tc-day">{format(date, "d")}</div>
              <div className="tc-lunar">农历{lunarLabel(now)}</div>
            </div>
            <div className="hero-text">
              <h1 className="hero-narration">
                <span className="line-main">{highlight(narration[0])}</span>
                <span className="line-sub">{highlight(narration[1])}</span>
              </h1>
              {todayItems.length > 0 && (
                <div className="today-line">
                  {todayItems.slice(0, 4).map((e) => {
                    const Icon = typeIcons[e.type];
                    return (
                      <button
                        key={e.id}
                        className={`today-chip ${e.type}`}
                        onClick={() => onOccurrence(e)}
                      >
                        <Icon size={13} />
                        {e.title}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="hero-actions">
                <button className="primary" onClick={onAdd}>
                  <Plus size={18} />
                  添加日程
                </button>
                <button onClick={() => onNavigate("calendar")}>
                  <CalendarDays size={16} />
                  打开日历
                </button>
              </div>
            </div>
          </div>
          {nextBirthday && spotlight && (
            <aside className="spotlight" aria-label="下一位寿星">
              <button
                className="spot-portrait"
                onClick={() => onCharacter(spotlight)}
                aria-label={"查看 " + spotlight.name}
              >
                <Avatar character={spotlight} size="spot" />
                <Sparkle size={20} className="spot-spark a" />
                <Sparkle size={12} className="spot-spark b" />
              </button>
              <div className="spot-body">
                <span className="chip birthday">
                  <Cake size={13} />
                  {nextBirthday.date === now
                    ? "今天生日"
                    : `下一位寿星 · ${daysUntil(nextBirthday.date)} 天后`}
                </span>
                <strong className="spot-name">{spotlight.name}</strong>
                <span className="spot-work">
                  {spotlight.works[0] || "未填写作品"}
                </span>
                <div className="spot-note" aria-live="polite">
                  {note.status === "ok" && <p>{note.text}</p>}
                  {note.status === "loading" && (
                    <p className="note-hint">
                      <Loader2 className="spin" size={14} />
                      正在收到 {spotlight.name} 的留言…
                    </p>
                  )}
                  {note.status === "off" && (
                    <p className="note-hint">
                      已关闭自动生成留言。
                      <button className="text-button" onClick={refreshNote}>
                        收取留言
                      </button>
                    </p>
                  )}
                  {note.status === "unconfigured" && (
                    <p className="note-hint">
                      配置 AI 接口后，这里会收到 TA 以角色口吻发来的生日留言。
                      <button
                        className="text-button"
                        onClick={() => onNavigate("settings")}
                      >
                        去设置
                      </button>
                    </p>
                  )}
                  {note.status === "error" && (
                    <p className="note-hint">
                      留言没有收到：{note.error}
                      <button className="text-button" onClick={refreshNote}>
                        重试
                      </button>
                    </p>
                  )}
                </div>
                <div className="spot-actions">
                  <button
                    className="spot-icon ai"
                    title="和这个角色聊天，也能让 AI 推荐绘画 prompt"
                    aria-label="和角色聊天"
                    onClick={() => onChat(spotlight)}
                  >
                    AI
                  </button>
                  <button
                    className="spot-icon"
                    title="为这位寿星建一个创作任务"
                    aria-label="建任务"
                    onClick={() =>
                      onNewTask(
                        spotlight.id,
                        nextBirthday.date,
                        `${spotlight.name} 生日贺图`,
                      )
                    }
                  >
                    <CalendarPlus size={17} />
                  </button>
                  <button
                    className={`spot-icon${copied === spotlight.id ? " done" : ""}`}
                    title="复制 Tag"
                    aria-label="复制 Tag"
                    onClick={() => void copyTag(spotlight)}
                  >
                    {copied === spotlight.id ? (
                      <Check size={17} />
                    ) : (
                      <Copy size={17} />
                    )}
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
        <div className="hero-stats">
          <button onClick={() => onNavigate("characters")}>
            <Users size={17} />
            <strong>{data.characters.length}</strong>
            <span>关注角色</span>
          </button>
          <button onClick={() => onNavigate("calendar")}>
            <CalendarHeart size={17} />
            <strong>{soon}</strong>
            <span>近期生日 · 未来 30 天</span>
          </button>
          <button onClick={() => onNavigate("tasks")}>
            <CalendarClock size={17} />
            <strong>{queue.length}</strong>
            <span>待完成创作</span>
          </button>
          <button onClick={() => onNavigate("tasks")}>
            <Hourglass size={17} />
            <strong>{doing}</strong>
            <span>进行中的创作</span>
          </button>
        </div>
      </section>
      <section className="birthday-section">
        <div className="section-heading">
          <h2>
            <Cake size={18} />
            近期角色生日 <span className="count">{shown.length}</span>
          </h2>
          <div className="heading-tools">
            <label className="check-label chip-check">
              <input
                type="checkbox"
                checked={onlyStarred}
                onChange={(e) => setOnlyStarred(e.target.checked)}
              />
              <Star size={14} />
              仅标星
            </label>
            <div className="segmented" role="group" aria-label="近期生日显示行数">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={rows === n ? "selected" : ""}
                  aria-pressed={rows === n}
                  onClick={() => chooseRows(n)}
                >
                  {n} 行
                </button>
              ))}
            </div>
          </div>
        </div>
        <div ref={strip}>
          {shown.length ? (
            <div
              className="birthday-list birthday-grid"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {shown.map((e) => {
                const c = data.characters.find(
                  (c) => c.id === e.characterIds[0],
                )!;
                const days = daysUntil(e.date);
                return (
                  <article
                    key={e.id}
                    className={`birthday-card${days === 0 ? " is-today" : ""}`}
                  >
                    <button
                      className="birthday-portrait"
                      onClick={() => onCharacter(c)}
                      aria-label={"编辑 " + c.name}
                    >
                      <Avatar character={c} size="portrait" />
                      <span className="bc-tags">
                        <span className="bc-date">{shortDate(e.date)}</span>
                        <span className="bc-count">
                          {days === 0 ? "今天生日" : `${days} 天后`}
                        </span>
                      </span>
                    </button>
                    <StarButton
                      className="card-star"
                      starred={c.starred}
                      name={c.name}
                      onToggle={() => onStar(c)}
                    />
                    <div className="birthday-card-footer">
                      <div className="bc-text">
                        <button
                          className="birthday-name text-button"
                          onClick={() => onCharacter(c)}
                        >
                          {c.name}
                        </button>
                        <span className="birthday-work">
                          {c.works[0] || "未填写作品"}
                        </span>
                      </div>
                      <IconButton
                        title={`和 ${c.name} 聊天`}
                        className="ai-chip"
                        onClick={() => onChat(c)}
                      >
                        AI
                      </IconButton>
                      <IconButton
                        title={`复制 ${c.name} 的 Tag`}
                        onClick={() => void onCopyTag(c.id)}
                      >
                        <Copy size={16} />
                      </IconButton>
                    </div>
                  </article>
                );
              })}
              <button
                className="birthday-more"
                style={{ gridColumn: `span ${lastSpan}` }}
                onClick={() => onNavigate("calendar")}
              >
                <CalendarHeart size={26} />
                <strong>全年生日</strong>
                <span>在日历中浏览 · 共 {confirmed} 位</span>
              </button>
            </div>
          ) : (
            <div className="birthday-empty panel">
              <Empty
                action={
                  <button onClick={() => onNavigate("characters")}>
                    查看角色库
                    <ArrowRight size={16} />
                  </button>
                }
              >
                <strong>
                  {onlyStarred ? "还没有标星角色的近期生日" : "还没有已确认的近期生日"}
                </strong>
                <br />
                {onlyStarred
                  ? "在卡片右上角点星标，或取消「仅标星」"
                  : `${data.characters.filter(needsBirthday).length} 位角色的生日待确认`}
              </Empty>
            </div>
          )}
        </div>
      </section>
      <div className="home-grid">
        <div className="home-main">
        <section className="panel task-glance">
          <div className="section-heading tight">
            <h2>
              <Brush size={17} />
              创作队列
            </h2>
            <button
              className="text-button muted"
              onClick={() => onNavigate("tasks")}
            >
              看板
              <ArrowRight size={14} />
            </button>
          </div>
          {queue.length ? (
            <div className="glance-list">
              {queue.slice(0, 4).map((t) => {
                const chars = t.characterIds
                  .map((id) => data.characters.find((c) => c.id === id))
                  .filter((c): c is Character => !!c);
                const late = daysUntil(t.date) < 0;
                return (
                  <div className={`glance-row ${t.status}`} key={t.id}>
                    <button
                      className="glance-main"
                      onClick={() => onTask(t)}
                      title={`编辑任务 ${t.title}`}
                    >
                      <span className="glance-status">
                        {statusLabels[t.status]}
                      </span>
                      <strong>{t.title}</strong>
                      <span className={late ? "late" : ""}>
                        {late ? "已逾期 · " : ""}
                        {shortDate(t.date)}
                      </span>
                    </button>
                    <AvatarStack characters={chars} />
                    <IconButton
                      title={`完成 ${t.title}`}
                      onClick={() => onStatus(t, "done")}
                    >
                      <Check size={16} />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted small-note">
              暂无待办创作，从左侧灵感里挑一个吧。
            </p>
          )}
        </section>
        <section className="ideas-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                <Sparkle size={11} />
                灵感提前到达
              </div>
              <h2>现在开始，刚刚好</h2>
            </div>
            <button
              className="text-button muted"
              onClick={() => onNavigate("recommendations")}
            >
              年度选题
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="idea-grid">
            {ideas.map((r, i) => (
              <IdeaCard
                key={r.id}
                recommendation={r}
                data={data}
                index={i}
                onCopyTag={onCopyTag}
              />
            ))}
          </div>
        </section>
        </div>
        <div className="home-side">
          <section className="panel holiday-section">
            <div className="section-heading tight">
              <h2>
                <Flower2 size={17} />
                节日与节气
              </h2>
              <IconButton title="查看日历" onClick={() => onNavigate("calendar")}>
                <ArrowRight size={18} />
              </IconButton>
            </div>
            <div className="holiday-filters">
              <select
                aria-label="节日类型筛选"
                value={holidayFilter}
                onChange={(e) => setHolidayFilter(e.target.value)}
              >
                <option value="all">全部节日</option>
                <option value="holiday">公历节日</option>
                <option value="lunar">农历节日</option>
                <option value="term">二十四节气</option>
                <option value="custom">自定义节日</option>
              </select>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={showExcluded}
                  onChange={(e) => setShowExcluded(e.target.checked)}
                />
                显示排除
              </label>
            </div>
            <div className="holiday-list">
              {holidays.map((e) => {
                return (
                  <div
                    className={`holiday-row${isHolidayExcluded(e, data) ? " excluded" : ""}`}
                    key={e.id}
                  >
                    <button
                      className="holiday-open"
                      onClick={() => onOccurrence(e)}
                    >
                      <div className="grow">
                        <strong>{e.title}</strong>
                        <span>
                          {e.note === "二十四节气"
                            ? "二十四节气"
                            : eventLabels[e.type]}
                        </span>
                      </div>
                      <div className="holiday-date">
                        <strong>{shortDate(e.date)}</strong>
                        <span>{daysUntil(e.date)} 天后</span>
                      </div>
                    </button>
                    <IconButton
                      title={`${isHolidayExcluded(e, data) ? "恢复" : "排除"}${e.title}`}
                      onClick={() => toggleExcluded(e)}
                    >
                      {isHolidayExcluded(e, data) ? (
                        <PlusCircle size={16} />
                      ) : (
                        <Minus size={16} />
                      )}
                    </IconButton>
                  </div>
                );
              })}
              {!holidays.length && (
                <p className="muted">未来两年没有符合筛选的节日</p>
              )}
            </div>
            <button className="add-line" onClick={onEvent}>
              <Plus size={16} />
              添加自定义节日
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
