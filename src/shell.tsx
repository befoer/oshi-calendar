import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  CalendarPlus,
  CalendarDays,
  Download,
  Loader2,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  UserPlus,
  Wand2,
  CornerDownLeft,
} from "lucide-react";
import type { Character, Data } from "./domain";
import { today, localDate } from "./calendar";
import {
  BrandMark,
  Avatar,
  Sparkle,
  lunarLabel,
  navigation,
  type Page,
} from "./ui";

type ThemeSetting = "system" | "light" | "dark";

/** 当前实际生效的明暗（跟随系统时读取系统偏好）。 */
function useResolvedTheme(theme: ThemeSetting) {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemeSetting;
  onChange: (t: ThemeSetting) => void;
}) {
  const resolved = useResolvedTheme(theme);
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      title={next === "dark" ? "切换到夜间模式" : "切换到日间模式"}
      aria-label={next === "dark" ? "切换到夜间模式" : "切换到日间模式"}
      data-theme-now={resolved}
      onClick={() => onChange(next)}
    >
      {resolved === "dark" ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}

export function Rail({
  page,
  onNavigate,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
}) {
  return (
    <aside className="rail">
      <button
        className="rail-brand"
        title="推日 · 回到工作台"
        aria-label="推日，回到工作台"
        onClick={() => onNavigate("home")}
      >
        <BrandMark size={46} />
        <strong>推日</strong>
      </button>
      <nav aria-label="主导航">
        {navigation.map((n) => (
          <button
            key={n.id}
            className={`nav-item${page === n.id ? " active" : ""}${n.id === "settings" ? " push" : ""}`}
            aria-label={n.label}
            aria-current={page === n.id ? "page" : undefined}
            onClick={() => onNavigate(n.id)}
          >
            <span className="nav-ico">
              <n.icon size={21} />
            </span>
            <span className="nav-label">{n.short}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export function QuickCreate({
  onEvent,
  onTask,
  onCharacter,
}: {
  onEvent: () => void;
  onTask: () => void;
  onCharacter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const items = [
    { icon: CalendarPlus, label: "添加日程", hint: "节日 · 纪念日", run: onEvent },
    { icon: Wand2, label: "新建创作任务", hint: "排进看板", run: onTask },
    { icon: UserPlus, label: "添加角色", hint: "搜索导入或手动录入", run: onCharacter },
  ];
  return (
    <div className="quick-create" ref={box}>
      <button
        className="primary quick-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus size={18} />
        <span>新建</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map(({ icon: Icon, label, hint, run }) => (
            <button
              key={label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                run();
              }}
            >
              <Icon size={17} />
              <span>
                {label}
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  data,
  assistantBusy,
  onSearch,
  onAssistant,
  onTheme,
  quickCreate,
}: {
  data: Data;
  assistantBusy: boolean;
  onSearch: () => void;
  onAssistant: () => void;
  onTheme: (t: ThemeSetting) => void;
  quickCreate: ReactNode;
}) {
  const now = today();
  return (
    <header className="topbar">
      <div className="top-brand">
        <BrandMark size={34} />
      </div>
      <div className="top-date">
        <strong>
          {format(localDate(now), "M月d日 EEEE", { locale: zhCN })}
        </strong>
        <span>农历{lunarLabel(now)}</span>
      </div>
      <button
        className="search-trigger"
        onClick={onSearch}
        aria-label="搜索与快速跳转"
      >
        <Search size={17} />
        <span>搜索角色、作品，或跳转页面…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="top-actions">
        {quickCreate}
        <button className="ai-button" onClick={onAssistant}>
          <Sparkles size={17} />
          <span>AI 助手</span>
          {assistantBusy && (
            <Loader2 className="spin" size={14} aria-label="AI 正在运行" />
          )}
        </button>
        <ThemeToggle theme={data.settings.theme} onChange={onTheme} />
      </div>
    </header>
  );
}

type Command = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords: string;
  run: () => void;
};

export function CommandPalette({
  data,
  onClose,
  onNavigate,
  onCharacter,
  onCopyTag,
  actions,
}: {
  data: Data;
  onClose: () => void;
  onNavigate: (p: Page) => void;
  onCharacter: (c: Character) => void;
  onCopyTag: (characterId: string) => void;
  actions: {
    event: () => void;
    task: () => void;
    character: () => void;
    assistant: () => void;
    theme: () => void;
    exportICS: () => void;
  };
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  const all = useMemo<Command[]>(() => {
    const go = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const pages = navigation.map<Command>((n) => ({
      id: `page:${n.id}`,
      group: "跳转到",
      label: n.label,
      icon: <n.icon size={17} />,
      keywords: n.label + n.short + n.id,
      run: go(() => onNavigate(n.id)),
    }));
    const quick: Command[] = [
      ["添加日程", "节日、纪念日", <CalendarPlus size={17} />, actions.event],
      ["新建创作任务", "排进看板", <Wand2 size={17} />, actions.task],
      ["添加角色", "搜索导入或手动录入", <UserPlus size={17} />, actions.character],
      ["打开 AI 助手", "对话式整理资料", <Sparkles size={17} />, actions.assistant],
      ["切换日间 / 夜间模式", "", <Moon size={17} />, actions.theme],
      ["导出日历（.ics）", "未来两年", <Download size={17} />, actions.exportICS],
    ].map(([label, hint, icon, run]) => ({
      id: `action:${label}`,
      group: "快捷操作",
      label: label as string,
      hint: hint as string,
      icon: icon as ReactNode,
      keywords: label as string,
      run: go(run as () => void),
    }));
    const people = data.characters.flatMap<Command>((c) => [
      {
        id: `char:${c.id}`,
        group: "角色",
        label: c.name,
        hint: c.works[0] || "未填写作品",
        icon: <Avatar character={c} size="tiny" />,
        keywords: [c.name, ...c.aliases, ...c.works].join(" "),
        run: go(() => onCharacter(c)),
      },
      {
        id: `tag:${c.id}`,
        group: "角色",
        label: `复制 Tag · ${c.name}`,
        hint: "直接复制生图 Tag",
        icon: <Sparkle size={15} />,
        keywords: [c.name, ...c.aliases, "tag", "复制", "prompt"].join(" "),
        run: go(() => onCopyTag(c.id)),
      },
    ]);
    return [...pages, ...quick, ...people];
  }, [data.characters, onClose, onNavigate, onCharacter, onCopyTag, actions]);
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return all.filter((c) => c.group !== "角色" || c.id.startsWith("char:")).slice(0, 14);
    return all
      .filter((c) => c.keywords.toLowerCase().includes(q))
      .slice(0, 24);
  }, [all, q]);
  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      results[index]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };
  let lastGroup = "";
  return (
    <div
      className="modal-shade palette-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="搜索与快速跳转"
        onKeyDown={key}
      >
        <div className="palette-input">
          <Search size={19} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-label="搜索角色、作品，或跳转页面"
            placeholder="搜索角色、作品，或输入「日历」「任务」…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{c.group}</div>}
                <button
                  role="option"
                  aria-selected={i === index}
                  className={i === index ? "active" : ""}
                  onMouseMove={() => setIndex(i)}
                  onClick={c.run}
                >
                  <span className="pi-icon">{c.icon}</span>
                  <span className="pi-label">{c.label}</span>
                  {c.hint && <small>{c.hint}</small>}
                  {i === index && <CornerDownLeft size={14} className="pi-enter" />}
                </button>
              </div>
            );
          })}
          {!results.length && (
            <p className="palette-empty">
              <CalendarDays size={18} />
              没有找到「{query}」，换个关键词试试
            </p>
          )}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}
