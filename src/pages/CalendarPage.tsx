import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  CalendarHeart,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ListFilter,
  Pencil,
  Plus,
  ArrowRight,
  Star,
} from "lucide-react";
import type { Character, Data, Task } from "../domain";
import {
  today,
  localDate,
  dateKey,
  occurrences,
  type Occurrence,
} from "../calendar";
import {
  Avatar,
  AvatarStack,
  Empty,
  IconButton,
  PageHeader,
  TypeBadge,
  eventLabels,
  lunarLabel,
  shortTitle,
  shortDate,
  statusLabels,
  typeIcons,
  weekdayLabel,
} from "../ui";

const MAX_PER_DAY = 3;
const typeOrder = { birthday: 0, holiday: 1, custom: 2, task: 3 } as const;

function OccurrenceAvatars({
  occurrence,
  data,
}: {
  occurrence: Occurrence;
  data: Data;
}) {
  const characters = occurrence.characterIds
    .map((id) => data.characters.find((c) => c.id === id))
    .filter((c): c is Character => !!c);
  if (!characters.length) {
    const Icon = typeIcons[occurrence.type];
    return (
      <span className="event-dot">
        <Icon size={11} />
      </span>
    );
  }
  return (
    <span className="occurrence-avatars">
      <AvatarStack characters={characters} />
    </span>
  );
}

export function CalendarView({
  data,
  onOccurrence,
  onEvent,
  onExport,
  onAddEvent,
  onAddTask,
  onEditItem,
  onCopyTag,
}: {
  data: Data;
  onOccurrence: (e: Occurrence) => void;
  onEvent: () => void;
  onExport: (events?: Occurrence[]) => void;
  onAddEvent: (date: string) => void;
  onAddTask: (date: string) => void;
  onEditItem: (e: Occurrence) => void;
  onCopyTag: (characterId?: string) => Promise<boolean>;
}) {
  const [month, setMonth] = useState(startOfMonth(localDate(today()))),
    [view, setView] = useState("month"),
    [range, setRange] = useState(30),
    [type, setType] = useState(""),
    [character, setCharacter] = useState(""),
    [work, setWork] = useState(""),
    [status, setStatus] = useState(""),
    [moreFilters, setMoreFilters] = useState(false),
    [onlyStarred, setOnlyStarred] = useState(false),
    [selected, setSelected] = useState(today()),
    [selection, setSelection] = useState<string[]>([]);
  const start =
    view === "month"
      ? dateKey(startOfWeek(month, { weekStartsOn: 1 }))
      : today();
  const end =
    view === "month"
      ? dateKey(addDays(localDate(start), 41))
      : dateKey(addDays(localDate(today()), range));
  const works = useMemo(
    () => [...new Set(data.characters.flatMap((c) => c.works))],
    [data.characters],
  );
  const starredIds = new Set(
    data.characters.filter((c) => c.starred).map((c) => c.id),
  );
  const list = occurrences(data, start, end).filter(
    (e) =>
      (!onlyStarred || e.characterIds.some((id) => starredIds.has(id))) &&
      (!type || e.type === type) &&
      (!character || e.characterIds.includes(character)) &&
      (!work ||
        e.characterIds.some((id) =>
          data.characters.find((c) => c.id === id)?.works.includes(work),
        )) &&
      (!status || e.status === status),
  );
  const activeFilters = [character, work, status].filter(Boolean).length;
  const dayList = occurrences(data, selected, selected).filter(
    (e) =>
      (!type || e.type === type) &&
      (!onlyStarred || e.characterIds.some((id) => starredIds.has(id))),
  );
  const todayKey = today();
  const monthStart = dateKey(startOfMonth(month));
  const monthEnd = dateKey(addDays(addMonths(startOfMonth(month), 1), -1));
  const monthItems = occurrences(data, monthStart, monthEnd);
  const monthBirthdays = monthItems.filter((e) => e.type === "birthday");
  return (
    <>
      <PageHeader
        eyebrow="CALENDAR"
        title="创作日历"
        actions={
          <>
            <button
              onClick={() =>
                onExport(
                  selection.length
                    ? list.filter((e) => selection.includes(e.id))
                    : list,
                )
              }
            >
              <Download size={16} />
              {selection.length ? `导出 ${selection.length} 项` : "导出当前事项"}
            </button>
            <button className="primary" onClick={onEvent}>
              <Plus size={17} />
              添加日程
            </button>
          </>
        }
      >
        生日、节日与每一个创作计划
      </PageHeader>
      <div className="calendar-toolbar">
        <div className="month-switch">
          <IconButton
            title="上个月"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={20} />
          </IconButton>
          <h2>
            {format(month, "yyyy年")}
            <b>{format(month, "M月")}</b>
          </h2>
          <IconButton
            title="下个月"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight size={20} />
          </IconButton>
          <button
            onClick={() => {
              setMonth(startOfMonth(localDate(today())));
              setSelected(today());
            }}
          >
            今天
          </button>
        </div>
        <div className="legend-filter" role="group" aria-label="事件类型">
          <button
            className={type === "" ? "selected" : ""}
            aria-pressed={type === ""}
            onClick={() => setType("")}
          >
            全部
          </button>
          {Object.entries(eventLabels).map(([key, label]) => (
            <button
              key={key}
              className={`${key}${type === key ? " selected" : ""}`}
              aria-pressed={type === key}
              onClick={() => setType(type === key ? "" : key)}
            >
              <i />
              {label}
            </button>
          ))}
        </div>
        <div className="calendar-tools">
          <label className="check-label chip-check">
            <input
              type="checkbox"
              checked={onlyStarred}
              onChange={(e) => setOnlyStarred(e.target.checked)}
            />
            <Star size={15} />
            仅标星
          </label>
          <button
            className={`filter-toggle${moreFilters || activeFilters ? " active" : ""}`}
            aria-expanded={moreFilters}
            onClick={() => setMoreFilters(!moreFilters)}
          >
            <ListFilter size={16} />
            筛选{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          <div className="segmented">
            <button
              className={view === "month" ? "selected" : ""}
              onClick={() => setView("month")}
            >
              月历
            </button>
            <button
              className={view === "list" ? "selected" : ""}
              onClick={() => setView("list")}
            >
              近期列表
            </button>
          </div>
        </div>
      </div>
      {(moreFilters || view === "list") && (
        <div className="filter-bar compact">
          <select
            aria-label="角色筛选"
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
          >
            <option value="">全部角色</option>
            {data.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="作品筛选"
            value={work}
            onChange={(e) => setWork(e.target.value)}
          >
            <option value="">全部作品</option>
            {works.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
          <select
            aria-label="任务状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {view === "list" && (
            <select
              aria-label="列表范围"
              value={range}
              onChange={(e) => setRange(Number(e.target.value))}
            >
              {[30, 60, 90].map((n) => (
                <option key={n} value={n}>
                  未来 {n} 天
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {view === "month" ? (
        <div className="calendar-layout">
          <div className="calendar-grid">
            <div className="week-row">
              {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                <div key={d}>周{d}</div>
              ))}
            </div>
            <div className="month-cells">
              {Array.from({ length: 42 }, (_, i) => {
                const d = addDays(localDate(start), i),
                  key = dateKey(d);
                const events = list
                  .filter((e) => e.date === key)
                  .sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
                // 生日角色的头像铺满整个格子，文字压在图片上；其他事项在下方显示为小标签
                const art = events.filter((e) => e.type === "birthday").slice(0, 3);
                const rest = events.filter((e) => e.type !== "birthday");
                const shown = rest.slice(0, art.length ? 2 : MAX_PER_DAY);
                const hidden = events.length - art.length - shown.length;
                const select = (event: { stopPropagation: () => void }) => {
                  event.stopPropagation();
                  setSelected(key);
                };
                return (
                  <div
                    className={`day-cell${d.getMonth() !== month.getMonth() ? " outside" : ""}${key === todayKey ? " today" : ""}${key === selected ? " selected" : ""}${events.length ? " has-events" : ""}${art.length ? " has-art" : ""}`}
                    key={key}
                    onClick={() => setSelected(key)}
                  >
                    <button
                      className="day-number"
                      aria-label={`查看 ${key}`}
                      aria-pressed={key === selected}
                      onClick={select}
                    >
                      {d.getDate()}
                    </button>
                    {art.length > 0 && (
                      <div className={`day-art n-${art.length}`}>
                        {art.map((e) => {
                          const c = data.characters.find(
                            (c) => c.id === e.characterIds[0],
                          );
                          return (
                            <button
                              className={`calendar-event birthday ${e.status || ""}`}
                              key={e.id}
                              onClick={select}
                              title={`${e.title} ${e.note || ""}`}
                            >
                              {c ? (
                                <Avatar character={c} size="calendar" />
                              ) : (
                                <OccurrenceAvatars occurrence={e} data={data} />
                              )}
                              <span className="calendar-event-title">
                                {shortTitle(e)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {(shown.length > 0 || hidden > 0) && (
                      <div className="day-events">
                        {shown.map((e) => (
                          <button
                            className={`calendar-event ${e.type} ${e.status || ""}`}
                            key={e.id}
                            onClick={select}
                            title={`${e.title} ${e.note || ""}`}
                          >
                            <OccurrenceAvatars occurrence={e} data={data} />
                            <span className="calendar-event-title">
                              {shortTitle(e)}
                            </span>
                          </button>
                        ))}
                        {hidden > 0 && (
                          <button className="more-events" onClick={select}>
                            还有 {hidden} 项
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="calendar-side">
          <aside className="day-panel" aria-label="当日安排">
            <header>
              <div className="dp-date">
                <b>{Number(selected.slice(8))}</b>
                <div>
                  <strong>
                    {format(localDate(selected), "yyyy年M月", { locale: zhCN })}
                  </strong>
                  <span>
                    {weekdayLabel(selected)} · 农历{lunarLabel(selected)}
                    {selected === todayKey && (
                      <em className="chip birthday">今天</em>
                    )}
                  </span>
                </div>
              </div>
              <div className="dp-actions">
                <button
                  className="small"
                  aria-label="在此日添加日程"
                  onClick={() => onAddEvent(selected)}
                >
                  <Plus size={15} />
                  日程
                </button>
                <button
                  className="small primary"
                  aria-label="在此日新建任务"
                  onClick={() => onAddTask(selected)}
                >
                  <CalendarPlus size={15} />
                  任务
                </button>
              </div>
            </header>
            <div className="dp-list">
              {dayList.length ? (
                dayList.map((e) => (
                  <article
                    className={`day-detail-row ${e.type}`}
                    key={e.id}
                  >
                    <OccurrenceAvatars occurrence={e} data={data} />
                    <div className="grow">
                      <TypeBadge type={e.type} />
                      <h3>{e.title}</h3>
                      {e.note && <p>{e.note}</p>}
                      <p>
                        {e.type === "task"
                          ? statusLabels[e.status as Task["status"]]
                          : `提前 ${e.reminderDays} 天提醒`}
                      </p>
                    </div>
                    <div className="dd-actions">
                      <IconButton
                        title={`编辑 ${e.title}`}
                        onClick={() => onEditItem(e)}
                      >
                        {e.type === "holiday" ? (
                          <ArrowRight size={17} />
                        ) : (
                          <Pencil size={17} />
                        )}
                      </IconButton>
                      {e.type !== "task" && e.characterIds.length > 0 && (
                        <IconButton
                          title={`复制 ${shortTitle(e)} 的 Tag`}
                          onClick={() => void onCopyTag(e.characterIds[0])}
                        >
                          <Copy size={17} />
                        </IconButton>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <Empty>这一天还没有安排</Empty>
              )}
            </div>
          </aside>
          <section className="month-summary panel" aria-label="本月概览">
            <div className="section-heading tight">
              <h2>
                <CalendarHeart size={17} />
                {format(month, "M月")}概览
              </h2>
            </div>
            <div className="ms-stats">
              <span className="birthday">
                <b>{monthItems.filter((e) => e.type === "birthday").length}</b>
                生日
              </span>
              <span className="holiday">
                <b>{monthItems.filter((e) => e.type === "holiday").length}</b>
                节日
              </span>
              <span className="custom">
                <b>{monthItems.filter((e) => e.type === "custom").length}</b>
                自定义
              </span>
              <span className="task">
                <b>{monthItems.filter((e) => e.type === "task").length}</b>
                任务
              </span>
            </div>
            {monthBirthdays.length ? (
              <div className="ms-list">
                {monthBirthdays.map((e) => {
                  const c = data.characters.find(
                    (c) => c.id === e.characterIds[0],
                  );
                  return (
                    <button key={e.id} onClick={() => setSelected(e.date)}>
                      {c && <Avatar character={c} size="tiny" />}
                      <span>{c?.name ?? shortTitle(e)}</span>
                      <small>{shortDate(e.date)}</small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted small-note">本月没有已确认的角色生日</p>
            )}
          </section>
          </div>
        </div>
      ) : (
        <div className="event-table">
          <div className="table-heading">
            <span>日期</span>
            <span>事项</span>
            <span>类型</span>
            <span>提醒 / 状态</span>
          </div>
          {list.map((e) => (
            <div className="event-table-row" key={e.id}>
              <label className="event-select">
                <input
                  type="checkbox"
                  checked={selection.includes(e.id)}
                  onChange={(v) =>
                    setSelection(
                      v.target.checked
                        ? [...selection, e.id]
                        : selection.filter((id) => id !== e.id),
                    )
                  }
                />
                <span>
                  {e.date.slice(5).replace("-", ".")}
                  <small>{weekdayLabel(e.date, "EEE")}</small>
                </span>
              </label>
              <button
                className="text-button calendar-list-title"
                onClick={() => onOccurrence(e)}
              >
                <OccurrenceAvatars occurrence={e} data={data} />
                {e.title}
              </button>
              <span>
                <TypeBadge type={e.type} />
              </span>
              <span>
                {e.type === "task"
                  ? statusLabels[e.status as Task["status"]]
                  : `提前 ${e.reminderDays} 天`}
              </span>
            </div>
          ))}
          {!list.length && <Empty>这段时间没有符合条件的事项</Empty>}
        </div>
      )}
    </>
  );
}
