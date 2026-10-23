import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageIcon,
  Loader2,
  Palette,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { aiConfigured, completion, loadConfig } from "./ai";
import { loadPersona } from "./chat-persona";
import {
  chatSystemPrompt,
  composePhotoPrompt,
  parsePhoto,
  pick,
  photoAsks,
  pickChatQuick,
  pickImagePrompt,
  pickPromptAsk,
  parseSearchMarker,
  searchBrief,
  visibleText,
} from "./chat-prompts";
import { savedReplies } from "./birthday-note";
import type { Character } from "./domain";
import { defaultTag } from "./editors";
import { generateImage, imageConfigured, loadImageConfig } from "./image-gen";
import { Avatar, ErrorText, Modal } from "./ui";
import { localCharacterService } from "./external-network";
import { webRequest } from "./web";

type Message = {
  role: "user" | "assistant";
  content: string;
  /** 重新生成过的几个版本（含当前这条）和当前显示的是第几个 */
  variants?: string[];
  v?: number;
  /** 生成的图片地址（网址或 data URI） */
  image?: string;
  /** 生图用的提示词，不显示在聊天里，只在图片下提供「复制提示词」 */
  imagePrompt?: string;
  /** 角色联网搜索后回答时引用的网页 */
  sources?: { title: string; url: string }[];
  /** 正在进行的步骤（如「正在搜索…」），只在等待时显示，不保存 */
  status?: string;
};
const historyKey = (id: string) => `huiqi-chat-${id}`;
const MAX_SAVED = 60;
/** 对话按角色存在本机浏览器里，重新打开窗口还在；data: 图片太大不存，只留文字。 */
const readHistory = (id: string): Message[] => {
  try {
    const list = JSON.parse(localStorage.getItem(historyKey(id)) || "[]");
    return Array.isArray(list)
      ? list.filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
      : [];
  } catch {
    return [];
  }
};
const writeHistory = (id: string, list: Message[]) => {
  try {
    const keep = list
      .filter((m) => m.content || m.image)
      .slice(-MAX_SAVED)
      .map((m) =>
        m.image?.startsWith("data:")
          ? { ...m, image: undefined, content: m.content || "（图片未保存）" }
          : m,
      );
    if (keep.length) localStorage.setItem(historyKey(id), JSON.stringify(keep));
    else localStorage.removeItem(historyKey(id));
  } catch {
    /* 存不下也不影响聊天 */
  }
};
/** 没有历史时，用角色的开场白作为第一条消息。 */
const opening = (c: Character): Message[] =>
  c.chatGreeting?.trim()
    ? [{ role: "assistant", content: c.chatGreeting.trim() }]
    : [];

/**
 * 和角色聊天：由 AI 扮演角色；有「画点啥」「拍张照」按钮，聊天中也可以让角色拍照；
 * 回复可以重新生成（左右切换版本）、每条消息可编辑／删除；对话按角色保存在本机。
 */
export function CharacterChat({
  character,
  onClose,
  onSettings,
  notify,
}: {
  character: Character;
  onClose: () => void;
  onSettings: () => void;
  notify: (s: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = readHistory(character.id);
    return saved.length ? saved : opening(character);
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  // 每次打开窗口随机几条快捷输入：40% 是绘画 prompt 相关；AI 为这个角色写好的优先
  const [quick] = useState(() => pickChatQuick(savedReplies(character)));
  const controller = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const configured = aiConfigured(loadConfig());
  const tag = defaultTag(character).trim();
  const imageConfig = loadImageConfig();
  const imageReady = imageConfigured(imageConfig);
  const info = {
    name: character.name,
    works: character.works,
    tag,
    traits: character.traits,
  };
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) writeHistory(character.id, messages);
  }, [messages, busy, character.id]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length, busy]);

  const finish = (abort: AbortController) => {
    if (controller.current === abort) setBusy(false);
  };
  const begin = () => {
    setError("");
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    return abort;
  };

  /** 请求一条回复。swipe 为真时，结果作为最后一条回复的新版本；否则追加成新消息。 */
  const reply = async (history: Message[], swipe?: Message) => {
    const abort = begin();
    const showing = (text: string, status?: string): Message[] => [
      ...history,
      swipe
        ? { ...swipe, content: text, image: undefined, sources: undefined, status }
        : { role: "assistant", content: text, status },
    ];
    // 联网搜索需要本机服务（推日.exe 启动的 127.0.0.1）；纯静态网页没有
    const searchReady = localCharacterService();
    setMessages(showing(""));
    const persona = loadPersona();
    try {
      const base = [
        {
          role: "system",
          content: chatSystemPrompt(
            {
              ...info,
              traits: character.traits ?? "",
              personality: character.chatPersonality,
              examples: character.chatExamples,
              player: persona,
            },
            { photo: imageReady, syntax: imageConfig.syntax, search: searchReady },
          ),
        },
        // 发过照片的消息没有文字，告诉模型「已经发过照片」
        ...history.map(({ role, content, image }) => ({
          role,
          content: image ? content || "（发送了一张照片）" : content,
        })),
      ];
      const ask = (extra: { role: string; content: string }[] = []) =>
        completion(
          loadConfig(),
          [...base, ...extra],
          undefined,
          abort.signal,
          (partial) => setMessages(showing(visibleText(partial))),
        );
      let raw = String((await ask()).content ?? "");
      // 角色想查资料时只回一行 [[搜索: 关键词]]：应用替它搜索，把结果作为资料再问一次（每条回复最多一次）
      const query = searchReady ? parseSearchMarker(raw) : null;
      let sources: Message["sources"];
      if (query) {
        setMessages(showing("", `正在搜索「${query}」…`));
        let brief: string;
        try {
          const found = (await webRequest("search", { query }, abort.signal)) as {
            results: { title: string; url: string; snippet: string }[];
          };
          let page: { title: string; url: string; text: string } | undefined;
          if (found.results[0]) {
            setMessages(showing("", `正在阅读「${found.results[0].title}」…`));
            try {
              page = (await webRequest(
                "read",
                { url: found.results[0].url },
                abort.signal,
              )) as typeof page;
            } catch {
              if (abort.signal.aborted) throw new Error("已取消");
            }
          }
          brief = searchBrief(query, found.results, page);
          sources = found.results.slice(0, 3).map(({ title, url }) => ({ title, url }));
        } catch (e) {
          if (abort.signal.aborted) throw e;
          brief = `【应用提示，不是玩家说的话】网页搜索失败：${e instanceof Error ? e.message : "未知原因"}。请用角色口吻告诉玩家暂时查不到，不要编造，也不要再写搜索标记。`;
        }
        raw = String(
          (
            await ask([
              { role: "assistant", content: `[[搜索: ${query}]]` },
              { role: "user", content: brief },
            ])
          ).content ?? "",
        );
      }
      const scene = imageReady ? parsePhoto(raw) : null;
      const text = visibleText(raw) || (scene ? "" : "（没有收到回复）");
      const versions = swipe
        ? [...(swipe.variants ?? [swipe.content]), text]
        : undefined;
      const answered: Message = {
        role: "assistant",
        content: text,
        ...(versions ? { variants: versions, v: versions.length - 1 } : {}),
        ...(sources?.length ? { sources } : {}),
      };
      setMessages([
        ...history,
        ...(text || !scene ? [answered] : []),
        ...(scene ? [{ role: "assistant" as const, content: "" }] : []),
      ]);
      if (scene) {
        const prompt = composePhotoPrompt(info, scene, imageConfig.syntax);
        try {
          const image = await generateImage(imageConfig, prompt, abort.signal);
          setMessages((list) => [
            ...list.slice(0, -1),
            { role: "assistant", content: "", image, imagePrompt: prompt },
          ]);
        } catch (e) {
          if (abort.signal.aborted) return;
          setMessages((list) => list.slice(0, -1));
          setError(e instanceof Error ? e.message : "生图失败");
        }
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      setMessages(swipe ? [...history, swipe] : history);
      setError(
        (e instanceof Error ? e.message : "发送失败") +
          "。可到「设置 → AI 接口 → 连接诊断」查看卡在哪一步",
      );
    } finally {
      finish(abort);
    }
  };

  const send = (text: string) => {
    const content = text.trim();
    if (!content || busy || !configured) return;
    setDraft("");
    void reply([...messages, { role: "user", content }]);
  };
  const last = messages.length - 1;
  const canSwipe =
    configured &&
    !busy &&
    last >= 0 &&
    messages[last].role === "assistant" &&
    !messages[last].image &&
    messages[last].content !== "";
  /** 重新生成最后一条回复：新版本加进去，可以用左右箭头在几个版本之间切换。 */
  const swipe = () => {
    if (!canSwipe) return;
    void reply(messages.slice(0, last), messages[last]);
  };
  const showVariant = (index: number, to: number) =>
    setMessages((list) =>
      list.map((m, i) =>
        i === index && m.variants?.[to] !== undefined
          ? { ...m, v: to, content: m.variants[to] }
          : m,
      ),
    );
  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    setMessages((list) =>
      list.flatMap((m, i) => {
        if (i !== editing.index) return [m];
        if (!text) return [];
        const variants = m.variants?.map((x, vi) => (vi === m.v ? text : x));
        return [{ ...m, content: text, ...(variants ? { variants } : {}) }];
      }),
    );
    setEditing(null);
  };
  const remove = (index: number) => {
    setMessages((list) => list.filter((_, i) => i !== index));
    setEditing(null);
  };

  /** 「拍张照」：聊天里只显示一句场景话，发给接口的提示词不展示（图片下可复制）。 */
  const makeImage = async () => {
    if (busy || !imageReady) return;
    const typed = draft.trim();
    const prompt = typed || pickImagePrompt(info, Math.random, imageConfig.syntax);
    setDraft("");
    const abort = begin();
    setMessages((list) => [
      ...list,
      { role: "user", content: typed ? "照这个样子来一张～" : pick(photoAsks) },
      { role: "assistant", content: "" },
    ]);
    try {
      const image = await generateImage(imageConfig, prompt, abort.signal);
      setMessages((list) => [
        ...list.slice(0, -1),
        { role: "assistant", content: "", image, imagePrompt: prompt },
      ]);
    } catch (e) {
      if (abort.signal.aborted) return;
      setMessages((list) => list.slice(0, -2));
      setError(e instanceof Error ? e.message : "生图失败");
    } finally {
      finish(abort);
    }
  };
  const clear = () => {
    controller.current?.abort();
    setBusy(false);
    setMessages(opening(character));
    setEditing(null);
    setError("");
  };
  const stop = () => {
    controller.current?.abort();
    setBusy(false);
    setMessages((list) =>
      list.at(-1)?.role === "assistant" && !list.at(-1)!.content
        ? list.slice(0, -1)
        : list,
    );
  };
  const copy = (text: string, done: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => notify(done))
      .catch(() => notify("自动复制不可用，请手动选择文本"));
  const started = messages.some((m) => m.role === "user");

  return (
    <Modal title={`和 ${character.name} 聊天`} onClose={onClose} className="chat-modal">
      <div className="modal-body character-chat">
        {!configured && !imageReady && !messages.length ? (
          <p className="muted">
            还没有配置 AI 接口（聊天）和生图接口。
            <button className="text-button" onClick={onSettings}>
              去设置
            </button>
          </p>
        ) : (
          <>
            <div className="chat-head">
              <Avatar character={character} size="normal" />
              <div>
                <strong>{character.name}</strong>
                <span>{character.works[0] || "未填写作品"}</span>
              </div>
            </div>
            <div className="chat-log" ref={log} aria-live="polite">
              {!started && configured && (
                <div className="chat-empty">
                  <p>随便说点什么吧</p>
                  <div className="chat-quick" role="group" aria-label="快捷输入">
                    {quick.map((q) => (
                      <button key={q} disabled={busy} onClick={() => send(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`chat-line ${m.role}`}>
                  {m.role === "assistant" && (
                    <span className="chat-avatar">
                      <Avatar character={character} size="normal" />
                    </span>
                  )}
                  <div className="chat-body">
                    {editing?.index === i ? (
                      <div className="chat-edit">
                        <textarea
                          aria-label="编辑消息"
                          autoFocus
                          rows={3}
                          value={editing.text}
                          onChange={(e) =>
                            setEditing({ index: i, text: e.target.value })
                          }
                        />
                        <div className="chat-edit-actions">
                          <button className="primary small" onClick={saveEdit}>
                            保存
                          </button>
                          <button className="small" onClick={() => setEditing(null)}>
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="chat-text">
                        {m.image && (
                          <a href={m.image} target="_blank" rel="noreferrer">
                            <img
                              className="chat-image"
                              src={m.image}
                              alt={`${character.name} 的照片`}
                            />
                          </a>
                        )}
                        {m.content ||
                          (busy && i === last && !m.image ? (
                            <span className="chat-status">
                              <Loader2 className="spin" size={14} />
                              {m.status}
                            </span>
                          ) : null)}
                      </div>
                    )}
                    {!!m.sources?.length && editing?.index !== i && (
                      <div className="chat-sources" aria-label="搜索来源">
                        <Search size={12} />
                        {m.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={source.url}
                          >
                            {source.title}
                          </a>
                        ))}
                      </div>
                    )}
                    {m.image && m.imagePrompt && (
                      <button
                        className="chat-meta"
                        onClick={() => copy(m.imagePrompt!, "已复制提示词")}
                      >
                        复制提示词
                      </button>
                    )}
                    {i === last && m.role === "assistant" && !m.image && (
                      <div className="chat-swipe">
                        {(m.variants?.length ?? 0) > 1 && (
                          <>
                            <button
                              aria-label="上一个版本"
                              disabled={busy || (m.v ?? 0) <= 0}
                              onClick={() => showVariant(i, (m.v ?? 0) - 1)}
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <span>
                              {(m.v ?? 0) + 1} / {m.variants!.length}
                            </span>
                            <button
                              aria-label="下一个版本"
                              disabled={busy || (m.v ?? 0) >= m.variants!.length - 1}
                              onClick={() => showVariant(i, (m.v ?? 0) + 1)}
                            >
                              <ChevronRight size={14} />
                            </button>
                          </>
                        )}
                        {canSwipe && (
                          <button
                            aria-label="重新生成这条回复"
                            title="重新生成这条回复"
                            onClick={swipe}
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {!busy && editing?.index !== i && m.content !== "" && (
                    <div className="chat-tools">
                      {!m.image && (
                        <>
                          <button
                            title="复制"
                            aria-label="复制这条消息"
                            onClick={() => copy(m.content, "已复制")}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            title="编辑"
                            aria-label="编辑这条消息"
                            onClick={() => setEditing({ index: i, text: m.content })}
                          >
                            <Pencil size={13} />
                          </button>
                        </>
                      )}
                      <button
                        title="删除"
                        aria-label="删除这条消息"
                        onClick={() => remove(i)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  {!busy && m.image && editing?.index !== i && (
                    <div className="chat-tools">
                      <button
                        title="删除"
                        aria-label="删除这条消息"
                        onClick={() => remove(i)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <ErrorText error={error} />
          </>
        )}
      </div>
      <footer className="chat-footer">
        <button
          disabled={!configured || busy}
          title="让 AI 给你想画什么、写成绘画 prompt"
          onClick={() => send(pickPromptAsk({ name: character.name, tag }))}
        >
          <Palette size={16} />
          画点啥
        </button>
        <button
          disabled={!imageReady || busy}
          aria-label="生图"
          title={
            imageReady
              ? "输入框里有内容就按它来，没有就用预置画面"
              : "先到「设置 → 生图接口」配置"
          }
          onClick={() => void makeImage()}
        >
          <ImageIcon size={16} />
          拍张照
        </button>
        {started && (
          <button title="清空这个角色的对话" aria-label="清空对话" onClick={clear}>
            <Trash2 size={16} />
          </button>
        )}
        <textarea
          aria-label="发送给角色"
          rows={1}
          value={draft}
          disabled={!configured && !imageReady}
          placeholder={`对 ${character.name} 说点什么…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        {busy ? (
          <button onClick={stop} aria-label="停止">
            <Square size={16} />
          </button>
        ) : (
          <button
            className="primary"
            disabled={!configured || !draft.trim()}
            onClick={() => send(draft)}
            aria-label="发送"
          >
            <Send size={16} />
          </button>
        )}
      </footer>
    </Modal>
  );
}
