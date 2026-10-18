import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format } from "date-fns";
import {
  CalendarPlus,
  CalendarRange,
  Check,
  Copy,
  Flower2,
  Loader2,
  Pencil,
  Sparkles,
  Star,
} from "lucide-react";
import { put, repository } from "../store";
import type { Data, Recommendation, Task } from "../domain";
import { today, localDate, dateKey, localRecommendations } from "../calendar";
import { loadConfig, generateRecommendations } from "../ai";
import {
  Avatar,
  CharacterPicker,
  Empty,
  ErrorText,
  IconButton,
  Modal,
  PageHeader,
  shortDate,
  taskBlank,
} from "../ui";

export function IdeaCard({
  recommendation: r,
  data,
  index,
  onCopyTag,
  onTask,
  onEdit,
}: {
  recommendation: Recommendation;
  data: Data;
  index: number;
  onCopyTag: (characterId?: string) => Promise<boolean>;
  onTask?: (r: Recommendation) => void;
  onEdit?: (r: Recommendation) => void;
}) {
  const c = data.characters.find((c) => c.id === r.characterIds[0]);
  return (
    <article className={`idea-card tone-${index % 3}`}>
      <span className="idea-ghost" aria-hidden="true">
        {Number(r.dateEnd.slice(5, 7))}
      </span>
      <div className="idea-top">
        <span className="chip">
          {r.source === "ai" ? <Sparkles size={13} /> : <Flower2 size={13} />}
          {r.source === "ai" ? "AI 选题" : "季节 / 节日"}
        </span>
        <span className="idea-month">{r.dateEnd.slice(0, 7).replace("-", ".")}</span>
      </div>
      <h3>{r.title}</h3>
      <p>{r.reason}</p>
      <div className="idea-window">
        <CalendarRange size={14} />
        {shortDate(r.dateStart)} – {shortDate(r.dateEnd)}
      </div>
      <div className="idea-character">
        {c ? (
          <>
            <Avatar character={c} size="tiny" />
            <span>{c.name}</span>
          </>
        ) : (
          <span>任选角色</span>
        )}
      </div>
      <div className="idea-actions">
        <button
          disabled={!c}
          title={c ? `复制 ${c.name} 的 Tag` : "这个选题没有关联角色"}
          onClick={() => void onCopyTag(c?.id)}
        >
          <Copy size={15} />
          复制 Tag
        </button>
        {onEdit && (
          <IconButton title="编辑选题" onClick={() => onEdit(r)}>
            <Pencil size={16} />
          </IconButton>
        )}
        {onTask && (
          <IconButton title="保存为创作任务" onClick={() => onTask(r)}>
            <CalendarPlus size={17} />
          </IconButton>
        )}
      </div>
    </article>
  );
}

export function Recommendations({
  data,
  notify,
  onCopyTag,
  onTask,
}: {
  data: Data;
  notify: (s: string) => void;
  onCopyTag: (characterId?: string) => Promise<boolean>;
  onTask: (t: Task) => void;
}) {
  const [month, setMonth] = useState(""),
    [source, setSource] = useState(""),
    [editing, setEditing] = useState<Recommendation | null>(null),
    [onlyStarred, setOnlyStarred] = useState(false),
    [showAI, setShowAI] = useState(false);
  const starredIds = new Set(
    data.characters.filter((c) => c.starred).map((c) => c.id),
  );
  const all = useMemo(
    () => [
      ...data.recommendations,
      ...localRecommendations(data).filter(
        (r) => !data.recommendations.some((s) => s.id === r.id),
      ),
    ],
    [data],
  );
  const bySource = all.filter(
    (r) =>
      (!source || r.source === source) &&
      (!onlyStarred || r.characterIds.some((id) => starredIds.has(id))),
  );
  const ideas = bySource.filter(
    (r) => !month || r.dateEnd.slice(0, 7) === month,
  );
  const months = Array.from({ length: 13 }, (_, i) =>
    format(addMonths(localDate(today()), i), "yyyy-MM"),
  );
  const toTask = (r: Recommendation) => {
    const c = data.characters.find((c) => c.id === r.characterIds[0]);
    const p = c?.presets.find((p) => p.id === c.defaultPresetId);
    onTask({
      ...taskBlank(),
      title: r.title,
      date: r.dateEnd,
      characterIds: r.characterIds,
      positive: p?.positive ?? "",
    });
  };
  return (
    <>
      <PageHeader
        eyebrow="A YEAR OF INSPIRATION"
        title="年度选题"
        actions={
          <button className="primary" onClick={() => setShowAI(true)}>
            <Sparkles size={17} />
            AI 生成选题
          </button>
        }
      >
        从现在到明年，把季节与角色的故事提前安排
      </PageHeader>
      <div className="month-ribbon" role="group" aria-label="月份筛选">
        <button
          className={month === "" ? "selected" : ""}
          aria-pressed={month === ""}
          onClick={() => setMonth("")}
        >
          未来一年
          <small>{bySource.length}</small>
        </button>
        {months.map((m) => {
          const count = bySource.filter(
            (r) => r.dateEnd.slice(0, 7) === m,
          ).length;
          return (
            <button
              key={m}
              className={month === m ? "selected" : ""}
              aria-pressed={month === m}
              onClick={() => setMonth(m)}
              aria-label={m}
            >
              {Number(m.slice(5))}月<i>{m.slice(2, 4)}</i>
              <small>{count}</small>
            </button>
          );
        })}
      </div>
      <div className="filter-bar">
        <div className="segmented">
          {[
            ["", "全部"],
            ["local", "本地题材"],
            ["ai", "AI 选题"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={source === v ? "selected" : ""}
              onClick={() => setSource(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="check-label chip-check">
          <input
            type="checkbox"
            checked={onlyStarred}
            onChange={(e) => setOnlyStarred(e.target.checked)}
          />
          <Star size={14} />
          仅标星角色
        </label>
        <span className="muted result-count">{ideas.length} 个选题</span>
      </div>
      <div className="idea-grid annual">
        {ideas.map((r, i) => (
          <IdeaCard
            key={r.id}
            recommendation={r}
            data={data}
            index={i}
            onCopyTag={onCopyTag}
            onTask={toTask}
            onEdit={setEditing}
          />
        ))}
      </div>
      {!ideas.length && <Empty>暂无选题</Empty>}
      {editing && (
        <RecommendationEditor
          initial={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notify("选题已保存");
          }}
        />
      )}
      {showAI && (
        <AIRecommendations
          data={data}
          onClose={() => setShowAI(false)}
          notify={notify}
        />
      )}
    </>
  );
}

function RecommendationEditor({
  initial,
  data,
  onClose,
  onSaved,
}: {
  initial: Recommendation;
  data: Data;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState("");
  const save = async () => {
    try {
      await put("recommendations", value, `保存选题：${value.title}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };
  return (
    <Modal title="编辑选题" onClose={onClose}>
      <div className="modal-body">
        <label>
          选题标题
          <input
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            开始日期
            <input
              type="date"
              value={value.dateStart}
              onChange={(e) =>
                setValue({ ...value, dateStart: e.target.value })
              }
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={value.dateEnd}
              onChange={(e) => setValue({ ...value, dateEnd: e.target.value })}
            />
          </label>
        </div>
        <label>
          选题理由
          <textarea
            rows={3}
            value={value.reason}
            onChange={(e) => setValue({ ...value, reason: e.target.value })}
          />
        </label>
        <CharacterPicker
          data={data}
          selected={value.characterIds}
          onChange={(characterIds) => setValue({ ...value, characterIds })}
        />
        <ErrorText error={error} />
      </div>
      <footer>
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={() => void save()}>
          <Check size={16} />
          保存选题
        </button>
      </footer>
    </Modal>
  );
}

function AIRecommendations({
  data,
  onClose,
  notify,
}: {
  data: Data;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [config] = useState(loadConfig()),
    [start, setStart] = useState(today()),
    [end, setEnd] = useState(dateKey(addMonths(localDate(today()), 3))),
    [ids, setIds] = useState(data.characters.slice(0, 5).map((c) => c.id)),
    [loading, setLoading] = useState(false),
    [result, setResult] = useState<Recommendation[]>([]),
    [error, setError] = useState("");
  const aiController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      aiController.current?.abort();
    },
    [],
  );
  const generate = async () => {
    if (end < start || !start || !end) {
      setError("请选择有效的日期范围");
      return;
    }
    setLoading(true);
    setError("");
    try {
      aiController.current = new AbortController();
      const records = await generateRecommendations(
        config,
        data,
        start,
        end,
        ids,
        aiController.current.signal,
      );
      await repository.apply(
        records.map((record) => ({
          collection: "recommendations",
          action: "put",
          record,
        })),
        `生成 ${records.length} 条 AI 选题`,
      );
      setResult(records);
      notify(`已生成 ${records.length} 条 AI 选题`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal title="AI 生成年度选题" onClose={onClose}>
      <div className="modal-body">
        <p>
          选择时间范围和角色，AI 会生成可编辑的主题与英文生图
          tag。不会发送角色私人备注。
        </p>
        <div className="form-row">
          <label>
            开始
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            结束
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <CharacterPicker data={data} selected={ids} onChange={setIds} />
        <details className="data-overview">
          <summary>发送内容概览</summary>
          <p>
            {start} 至 {end}；
            {ids
              .map((id) => data.characters.find((c) => c.id === id)?.name)
              .join("、")}
            ；作品、默认预设与本地题材。
          </p>
        </details>
        <ErrorText error={error} />
        {result.length > 0 && (
          <div className="result-list">
            {result.map((r) => (
              <div key={r.id}>
                <strong>{r.title}</strong>
                <span>
                  {r.dateStart} – {r.dateEnd}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <footer>
        <button
          onClick={() => {
            aiController.current?.abort();
            onClose();
          }}
        >
          取消
        </button>
        <button
          className="primary"
          disabled={loading || !ids.length}
          onClick={() => void generate()}
        >
          {loading ? (
            <>
              <Loader2 className="spin" size={16} />
              生成中
            </>
          ) : (
            <>
              <Sparkles size={16} />
              生成选题
            </>
          )}
        </button>
      </footer>
    </Modal>
  );
}
