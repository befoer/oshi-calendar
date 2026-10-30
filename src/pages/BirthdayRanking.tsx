import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Cake,
  Check,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { today } from "../calendar";
import { Avatar, IconButton } from "../ui";
import {
  loadBirthdayRanking,
  filterBirthdayRanking,
  type BirthdayGender,
  type BirthdayRankingEntry,
} from "../birthday-ranking";
import type { Character } from "../domain";
import { addRankingCharacter, rankingCharacter } from "../ranking-library";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; entries: BirthdayRankingEntry[]; warning?: string };

const genderKey = "oshi-birthday-ranking-gender";
function readGender(): BirthdayGender {
  try {
    const value = localStorage.getItem(genderKey);
    return value === "all" || value === "male" ? value : "female";
  } catch {
    return "female";
  }
}

export function BirthdayRanking({
  columns,
  first,
  onMove,
  characters,
}: {
  columns: number;
  first: boolean;
  onMove: () => void;
  characters: Character[];
}) {
  const [adding, setAdding] = useState<number[]>([]);
  const [addError, setAddError] = useState("");
  const add = async (entry: BirthdayRankingEntry) => {
    setAdding((ids) => [...ids, entry.id]);
    setAddError("");
    try {
      await addRankingCharacter(entry);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "添加失败，请重试");
    } finally {
      setAdding((ids) => ids.filter((id) => id !== entry.id));
    }
  };
  const [date, setDate] = useState(today);
  const [gender, setGender] = useState(readGender);
  const [visible, setVisible] = useState(5);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const update = () => setDate(today());
    const online = () => {
      update();
      setAttempt((n) => n + 1);
    };
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", online);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setVisible(5);
    setState({ status: "loading" });
    void loadBirthdayRanking(date, controller.signal, attempt > 0).then(
      (result) => {
        if (!controller.signal.aborted) setState({ status: "ok", ...result });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "暂时无法获取排名",
          });
      },
    );
    return () => controller.abort();
  }, [date, attempt]);

  const entries =
    state.status === "ok" ? filterBirthdayRanking(state.entries, gender) : [];
  const shown = entries.slice(0, visible);
  const gridColumns = Math.min(columns, 6);
  const lastSpan = gridColumns - (shown.length % gridColumns);
  const chooseGender = (value: BirthdayGender) => {
    setGender(value);
    setVisible(5);
    try {
      localStorage.setItem(genderKey, value);
    } catch {
      /* Session-only preference. */
    }
  };

  return (
    <section
      className="birthday-ranking"
      aria-labelledby="birthday-ranking-title"
    >
      <div className="section-heading">
        <h2 id="birthday-ranking-title">
          <Cake size={18} />
          今日人气寿星
        </h2>
        <div className="heading-tools ranking-tools">
          <div className="segmented" role="group" aria-label="寿星性别">
            {(
              [
                ["female", "女角色"],
                ["male", "男角色"],
                ["all", "全部"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={gender === value ? "selected" : ""}
                aria-pressed={gender === value}
                onClick={() => chooseGender(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <IconButton
            title="刷新排名"
            disabled={state.status === "loading"}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton
            title={first ? "移到近期角色生日下方" : "移到近期角色生日上方"}
            onClick={onMove}
          >
            {first ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
          </IconButton>
        </div>
      </div>
      <p className="birthday-ranking-caption">
        {Number(date.slice(5, 7))} 月 {Number(date.slice(8))} 日 · 按 AniList
        人气排序
      </p>
      <div aria-live="polite">
        {addError && (
          <p role="alert" className="ranking-message">
            {addError}
          </p>
        )}
        {state.status === "loading" && (
          <p className="ranking-message" role="status">
            <Loader2 size={16} className="spin" />
            正在寻找今天的人气寿星…
          </p>
        )}
        {state.status === "error" && (
          <p className="ranking-message" role="status">
            {state.message}。可点击刷新排名重试。
          </p>
        )}
        {state.status === "ok" && (
          <>
            {state.warning && (
              <p className="ranking-message" role="status">
                {state.warning}
              </p>
            )}
            {entries.length ? (
              <ol
                className="birthday-ranking-list"
                style={{
                  gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                }}
              >
                {shown.map((entry) => (
                  <li key={entry.id}>
                    <article className="ranking-card">
                      <a
                        className="ranking-link"
                        href={`https://anilist.co/character/${entry.id}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${entry.name}，在 AniList 查看`}
                      >
                        <div className="ranking-portrait">
                          <Avatar character={entry} size="portrait" />
                        </div>
                        <div className="ranking-card-body">
                          <strong title={entry.name}>{entry.name}</strong>
                          <span className="ranking-work" title={entry.work}>
                            {entry.work || "作品资料暂无"}
                          </span>
                        </div>
                      </a>
                      <button
                        className="ranking-add"
                        title={
                          rankingCharacter(entry, characters)
                            ? "已在角色库"
                            : "添加到角色库"
                        }
                        aria-label={`${rankingCharacter(entry, characters) ? "已在角色库" : "添加到角色库"}：${entry.name}`}
                        disabled={
                          adding.includes(entry.id) ||
                          !!rankingCharacter(entry, characters)
                        }
                        onClick={() => void add(entry)}
                      >
                        {adding.includes(entry.id) ? (
                          <Loader2 size={15} className="spin" />
                        ) : rankingCharacter(entry, characters) ? (
                          <Check size={15} />
                        ) : (
                          <Plus size={15} />
                        )}
                        {rankingCharacter(entry, characters)
                          ? "已添加"
                          : "添加到角色库"}
                      </button>
                    </article>
                  </li>
                ))}
                <li
                  className="ranking-more"
                  style={{ gridColumn: `span ${lastSpan}` }}
                >
                  <button
                    className="birthday-more"
                    disabled={visible >= entries.length && visible <= 5}
                    onClick={() =>
                      setVisible(visible < entries.length ? visible + 5 : 5)
                    }
                  >
                    {visible < entries.length ? (
                      <Plus size={26} />
                    ) : (
                      <ChevronUp size={26} />
                    )}
                    <strong>
                      {visible < entries.length
                        ? "显示更多"
                        : visible > 5
                          ? "收起"
                          : "已显示全部"}
                    </strong>
                    <span>
                      {visible < entries.length
                        ? `还有 ${entries.length - shown.length} 位`
                        : `共 ${entries.length} 位`}
                    </span>
                  </button>
                </li>
              </ol>
            ) : (
              <p className="ranking-message">
                {state.entries.length
                  ? "AniList 暂无符合所选性别的今日寿星。"
                  : "AniList 暂无今天生日的角色记录。"}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
