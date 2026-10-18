import { useState } from "react";
import { ArrowRight, GripVertical, Plus, Star } from "lucide-react";
import type { Character, Data, Task } from "../domain";
import { daysUntil } from "../calendar";
import {
  AvatarStack,
  Empty,
  IconButton,
  PageHeader,
  countdown,
  shortDate,
  statusLabels,
} from "../ui";

const columns = ["todo", "doing", "done", "skipped"] as const;
const isLate = (t: Task) =>
  (t.status === "todo" || t.status === "doing") && daysUntil(t.date) < 0;

export function Tasks({
  data,
  onEdit,
  onAdd,
  onStatus,
}: {
  data: Data;
  onEdit: (t: Task) => void;
  onAdd: () => void;
  onStatus: (t: Task, s: Task["status"]) => void;
}) {
  const [status, setStatus] = useState(""),
    [character, setCharacter] = useState(""),
    [onlyStarred, setOnlyStarred] = useState(false),
    [view, setView] = useState<"board" | "list">("board"),
    [dragging, setDragging] = useState(""),
    [over, setOver] = useState("");
  const starredIds = new Set(
    data.characters.filter((c) => c.starred).map((c) => c.id),
  );
  const filtered = data.tasks
    .filter(
      (t) =>
        (!onlyStarred || t.characterIds.some((id) => starredIds.has(id))) &&
        (!status || t.status === status) &&
        (!character || t.characterIds.includes(character)),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const names = (t: Task) =>
    t.characterIds
      .map((id) => data.characters.find((c) => c.id === id)?.name || "已删除角色")
      .join(" · ") || "自由主题";
  const avatars = (t: Task) =>
    t.characterIds
      .map((id) => data.characters.find((c) => c.id === id))
      .filter((c): c is Character => !!c);
  const statusSelect = (t: Task) => (
    <select
      aria-label={`${t.title} 状态`}
      value={t.status}
      onChange={(e) => onStatus(t, e.target.value as Task["status"])}
    >
      {Object.entries(statusLabels).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  const done = data.tasks.filter((t) => t.status === "done").length;
  return (
    <>
      <PageHeader
        eyebrow="CREATION QUEUE"
        title="创作任务"
        actions={
          <button className="primary" onClick={onAdd}>
            <Plus size={17} />
            新建任务
          </button>
        }
      >
        {done} 项已完成 · 每一个灵感都有归处
      </PageHeader>
      <div className="filter-bar">
        <div className="segmented" aria-label="任务视图">
          <button
            className={view === "board" ? "selected" : ""}
            onClick={() => setView("board")}
          >
            看板
          </button>
          <button
            className={view === "list" ? "selected" : ""}
            onClick={() => setView("list")}
          >
            列表
          </button>
        </div>
        {view === "list" && (
          <div className="segmented">
            {[["", "全部"], ...Object.entries(statusLabels)].map(([v, l]) => (
              <button
                key={v}
                className={status === v ? "selected" : ""}
                onClick={() => setStatus(v)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <label className="check-label chip-check">
          <input
            type="checkbox"
            checked={onlyStarred}
            onChange={(e) => setOnlyStarred(e.target.checked)}
          />
          <Star size={15} />
          仅标星角色
        </label>
        <select
          aria-label="任务角色筛选"
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
      </div>
      {view === "board" ? (
        <div className="kanban">
          {columns.map((col) => {
            const items = filtered.filter((t) => t.status === col);
            return (
              <section
                key={col}
                className={`kanban-col ${col}${over === col ? " drag-over" : ""}`}
                aria-label={`${statusLabels[col]}任务`}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setOver(col);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setOver("");
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const task = data.tasks.find((t) => t.id === dragging);
                  setOver("");
                  setDragging("");
                  if (task && task.status !== col) onStatus(task, col);
                }}
              >
                <header>
                  <span className="kc-dot" />
                  <h2>{statusLabels[col]}</h2>
                  <span className="count">{items.length}</span>
                </header>
                <div className="kc-body">
                  {items.map((t) => (
                    <article
                      key={t.id}
                      className={`task-card ${t.status}${dragging === t.id ? " dragging" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                        setDragging(t.id);
                      }}
                      onDragEnd={() => {
                        setDragging("");
                        setOver("");
                      }}
                    >
                      <div className="tk-head">
                        <span className={`tk-date${isLate(t) ? " late" : ""}`}>
                          {isLate(t) ? "已逾期 · " : ""}
                          {shortDate(t.date)} · {countdown(t.date)}
                        </span>
                        <GripVertical size={15} className="grip" aria-hidden />
                      </div>
                      <button
                        className="text-button task-title"
                        onClick={() => onEdit(t)}
                      >
                        {t.title}
                      </button>
                      <div className="tk-meta">
                        <AvatarStack characters={avatars(t)} />
                        <span>{names(t)}</span>
                      </div>
                      <div className="tk-foot">
                        {statusSelect(t)}
                        <IconButton title="编辑任务" onClick={() => onEdit(t)}>
                          <ArrowRight size={16} />
                        </IconButton>
                      </div>
                    </article>
                  ))}
                  {!items.length && (
                    <p className="kc-empty">
                      {col === "todo" ? "新建任务，或把卡片拖到这里" : "拖动卡片到这里"}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="task-list">
          {filtered.map((t) => (
            <article className={`task-row ${t.status}`} key={t.id}>
              <div className="task-date">
                <strong>{t.date.slice(8)}</strong>
                <span>{t.date.slice(0, 7)}</span>
              </div>
              <div className="grow">
                <button className="text-button" onClick={() => onEdit(t)}>
                  {t.title}
                </button>
                <p>{names(t)}</p>
              </div>
              <AvatarStack characters={avatars(t)} />
              {statusSelect(t)}
              <IconButton title="编辑任务" onClick={() => onEdit(t)}>
                <ArrowRight size={18} />
              </IconButton>
            </article>
          ))}
          {!filtered.length && <Empty>还没有创作任务</Empty>}
        </div>
      )}
      {view === "board" && !data.tasks.length && (
        <Empty>还没有创作任务</Empty>
      )}
    </>
  );
}
