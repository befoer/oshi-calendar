import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Wand2 } from "lucide-react";
import {
  candidateTag,
  candidateTraits,
  lookupCharacterTags,
  loadAppearance,
  type TagLookup,
} from "./character-tags";

export type TagValue = { tag: string; traits: string };

/**
 * 角色的 Tag 与人物特征：
 * - Tag 只放角色标签本身（如 nahida \(genshin impact\)），所有复制按钮复制的就是它；
 * - 人物特征（发色、瞳色、服装…）单独保存，不随复制按钮复制。
 * 可手动填写，也可以从 Danbooru（回退 AnimaDex）自动获取。
 * `terms` 是用来搜索的名字，英文名优先；autoStart 时挂载后自动获取一次。
 */
export function TagField({
  terms,
  value,
  onChange,
  autoStart = false,
}: {
  terms: string[];
  value: TagValue;
  onChange: (next: TagValue) => void;
  autoStart?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    autoStart ? "loading" : "idle",
  );
  const [lookup, setLookup] = useState<TagLookup | null>(null);
  const [index, setIndex] = useState(0);
  const [saveTraits, setSaveTraits] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  // 回调始终读取最新值，避免异步结果覆盖掉用户刚改的内容
  const latest = useRef(value);
  latest.current = value;
  const apply = (next: TagLookup, i: number, traits: boolean) =>
    onChange({
      tag: candidateTag(next.candidates[i]),
      traits: traits ? candidateTraits(next.candidates[i]) : latest.current.traits,
    });
  const run = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState("loading");
    setError("");
    try {
      const result = await lookupCharacterTags(terms, abort.signal);
      if (abort.signal.aborted) return;
      setLookup(result);
      setIndex(0);
      setState("done");
      apply(result, 0, saveTraits);
    } catch (e) {
      if (abort.signal.aborted) return;
      setState("error");
      setError(e instanceof Error ? e.message : "获取失败");
    }
  };
  useEffect(() => {
    // 开发模式下 StrictMode 会先卸载再挂载一次：清理时中止上一次请求，重新挂载时再发起
    if (autoStart && terms.some((t) => t.trim())) void run();
    else if (autoStart) setState("idle");
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = async (i: number) => {
    if (!lookup) return;
    setIndex(i);
    let next = lookup;
    if (!lookup.candidates[i].loaded) {
      try {
        const loaded = await loadAppearance(lookup.candidates[i]);
        next = {
          ...lookup,
          candidates: lookup.candidates.map((c, n) => (n === i ? loaded : c)),
        };
        setLookup(next);
      } catch {
        /* 人物特征取不到时只换角色 Tag */
      }
    }
    apply(next, i, saveTraits);
  };
  const current = lookup?.candidates[index];
  return (
    <div className="tag-field">
      <label>
        <span className="tag-label">
          Tag
          {state === "done" && lookup && (
            <em className="tag-source">
              <CheckCircle2 size={13} />
              来自 {lookup.source}
              {current ? ` · ${current.count.toLocaleString()} 张` : ""}
            </em>
          )}
        </span>
        <textarea
          className="prompt-text"
          aria-label="Tag"
          rows={2}
          value={value.tag}
          spellCheck={false}
          placeholder="例如：nahida \(genshin impact\)"
          onChange={(e) => onChange({ ...value, tag: e.target.value })}
        />
      </label>
      <div className="tag-tools">
        <button
          type="button"
          className="small"
          disabled={state === "loading" || !terms.some((t) => t.trim())}
          onClick={() => void run()}
        >
          {state === "loading" ? (
            <Loader2 className="spin" size={14} />
          ) : state === "idle" ? (
            <Wand2 size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          {state === "loading"
            ? "正在获取…"
            : state === "idle"
              ? "自动获取 Tag"
              : "重新获取"}
        </button>
        {lookup && lookup.candidates.length > 1 && (
          <select
            aria-label="Tag 候选"
            value={index}
            onChange={(e) => void choose(Number(e.target.value))}
          >
            {lookup.candidates.map((c, i) => (
              <option key={c.slug} value={i}>
                {c.slug.replace(/_/g, " ")} · {c.count.toLocaleString()}
              </option>
            ))}
          </select>
        )}
        {lookup && (
          <label className="check-label tag-appearance">
            <input
              type="checkbox"
              checked={saveTraits}
              onChange={(e) => {
                setSaveTraits(e.target.checked);
                if (e.target.checked) apply(lookup, index, true);
                else onChange({ ...value, traits: "" });
              }}
            />
            同时保存人物特征
          </label>
        )}
      </div>
      <label>
        <span className="tag-label">
          人物特征
          <small>单独保存，不会随「复制 Tag」复制</small>
        </span>
        <textarea
          className="prompt-text"
          aria-label="人物特征"
          rows={2}
          value={value.traits}
          spellCheck={false}
          placeholder="例如：green eyes, white hair, pointy ears"
          onChange={(e) => onChange({ ...value, traits: e.target.value })}
        />
      </label>
      {state === "error" && (
        <p className="tag-error">
          <AlertCircle size={14} />
          未能自动获取：{error}。可以手动填写 Tag。
        </p>
      )}
    </div>
  );
}
