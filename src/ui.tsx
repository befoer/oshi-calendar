import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Solar } from "lunar-javascript";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  Lightbulb,
  SquareKanban,
  Settings as SettingsIcon,
  X,
  AlertCircle,
  Cake,
  PartyPopper,
  Star,
  Brush,
} from "lucide-react";
import {
  stamp,
  type Character,
  type CustomEvent,
  type Data,
  type Task,
} from "./domain";
import { today, localDate, daysUntil, type Occurrence } from "./calendar";
import { avatarFallbackURL } from "./external-network";

/* ---------- 导航与文案 ---------- */
export type Page =
  "home" | "calendar" | "characters" | "recommendations" | "tasks" | "settings";
export const navigation = [
  { id: "home", label: "创作工作台", short: "工作台", icon: LayoutDashboard },
  { id: "characters", label: "角色库", short: "角色库", icon: Users },
  { id: "calendar", label: "日历", short: "日历", icon: CalendarDays },
  { id: "recommendations", label: "年度选题", short: "选题", icon: Lightbulb },
  { id: "tasks", label: "创作任务", short: "任务", icon: SquareKanban },
  { id: "settings", label: "设置", short: "设置", icon: SettingsIcon },
] as const;
export const eventLabels = {
  birthday: "角色生日",
  holiday: "节日 / 节气",
  custom: "自定义",
  task: "创作任务",
};
export const typeIcons = {
  birthday: Cake,
  holiday: PartyPopper,
  custom: Star,
  task: Brush,
};
export const statusLabels = {
  todo: "待创作",
  doing: "进行中",
  done: "已完成",
  skipped: "已跳过",
};
export const missingBirthdayLabel = (character: Character) =>
  character.birthdayConfidence === "none"
    ? "无生日"
    : character.birthdaySource.includes("[网页核实：来源说明生日未公开]")
      ? "生日未公开"
      : "生日待确认";
export const needsBirthday = (c: Character) =>
  c.birthdayConfidence !== "confirmed" && c.birthdayConfidence !== "none";

/* ---------- 空白记录 ---------- */
export const taskBlank = (): Task => ({
  ...stamp(),
  title: "",
  date: today(),
  characterIds: [],
  status: "todo",
  positive: "",
  negative: "",
  notes: "",
});
export const eventBlank = (): CustomEvent => ({
  ...stamp(),
  title: "",
  recurrence: "solar",
  date: today(),
  month: Number(today().slice(5, 7)),
  day: Number(today().slice(8)),
  reminderDays: null,
  tags: "",
  notes: "",
});

/* ---------- 日期小工具 ---------- */
export const lunarLabel = (date: string) => {
  const lunar = Solar.fromYmd(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
  ).getLunar();
  return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
};
export const weekdayLabel = (date: string, style: "EEEE" | "EEE" = "EEEE") =>
  format(localDate(date), style, { locale: zhCN });
export const shortDate = (date: string) => date.slice(5).replace("-", ".");
export const countdown = (date: string) => {
  const n = daysUntil(date);
  return n === 0
    ? "今天"
    : n === 1
      ? "明天"
      : n < 0
        ? `${-n} 天前`
        : `${n} 天后`;
};
/** 日历格子里的紧凑标题：生日已有头像与配色，不再重复「· 生日」。 */
export const shortTitle = (e: Occurrence) =>
  e.type === "birthday" ? e.title.replace(/\s*·\s*生日$/, "") : e.title;
export const characterOf = (data: Data, occurrence: Occurrence) =>
  data.characters.find((c) => c.id === occurrence.characterIds[0]);

/* ---------- 品牌与装饰 ---------- */
export function Sparkle({
  size = 16,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`sparkle ${className}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 0c.8 7.2 4.8 11.2 12 12-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12C7.2 11.2 11.2 7.2 12 0Z"
      />
    </svg>
  );
}
export function BrandMark({ size = 44 }: { size?: number }) {
  const id = useId();
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8478e6" />
          <stop offset="1" stopColor="#6a8be4" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="15" fill={`url(#${id})`} />
      {/* 日历（含挂环）整体居中：左右各留 11 个单位，上下各留约 10.25 个单位 */}
      <g transform="translate(1 .75)">
        <rect x="10" y="14" width="26" height="23" rx="6" fill="#fff" />
        <path d="M10 22h26" stroke="#7d74e0" strokeOpacity=".25" strokeWidth="2" />
        <rect x="16" y="9.5" width="3.6" height="8" rx="1.8" fill="#fff" />
        <rect x="26.4" y="9.5" width="3.6" height="8" rx="1.8" fill="#fff" />
        <g transform="translate(23 24.5) scale(.62)">
          <path
            fill={`url(#${id})`}
            d="M12 0c.8 7.2 4.8 11.2 12 12-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12C7.2 11.2 11.2 7.2 12 0Z"
          />
        </g>
        <g transform="translate(12.5 28) scale(.26)" opacity=".85">
          <path
            fill="#d99bb4"
            d="M12 0c.8 7.2 4.8 11.2 12 12-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12C7.2 11.2 11.2 7.2 12 0Z"
          />
        </g>
      </g>
    </svg>
  );
}

/* ---------- 基础组件 ---------- */
export function IconButton({
  title,
  children,
  onClick,
  disabled,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, textarea, select, [tabindex="0"]',
          ) ?? [],
        );
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal ${wide ? "wide" : ""} ${className}`}
        ref={dialog}
      >
        <header>
          <h2>
            <Sparkle size={14} className="title-spark" />
            {title}
          </h2>
          <IconButton title="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
const hueOf = (name: string) =>
  [...name].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7);
export function Avatar({
  character,
  size = "normal",
}: {
  character: Character;
  size?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  useEffect(() => {
    setFailed(false);
    setUseFallback(false);
  }, [character.avatarUrl]);
  const fallback = avatarFallbackURL(character.avatarUrl);
  return (
    <div
      className={`avatar ${size}`}
      style={
        {
          "--h": hueOf(character.name),
          "--ax": `${character.avatarX ?? 50}%`,
          "--ay": `${character.avatarY ?? 18}%`,
          "--az": character.avatarZoom ?? 1,
        } as CSSProperties
      }
    >
      {character.avatarUrl && !failed ? (
        <img
          src={useFallback && fallback ? fallback : character.avatarUrl}
          alt={character.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() =>
            fallback && !useFallback ? setUseFallback(true) : setFailed(true)
          }
        />
      ) : (
        <span>{character.name.slice(0, 1)}</span>
      )}
    </div>
  );
}
export function AvatarStack({
  characters,
  size = "calendar",
  max = 3,
}: {
  characters: Character[];
  size?: string;
  max?: number;
}) {
  if (!characters.length) return null;
  const shown = characters.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((c) => (
        <Avatar key={c.id} character={c} size={size} />
      ))}
      {characters.length > max && (
        <span className="avatar-more">+{characters.length - max}</span>
      )}
    </span>
  );
}
export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <Sparkle size={34} className="s1" />
        <Sparkle size={16} className="s2" />
        <Sparkle size={11} className="s3" />
      </div>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function StarButton({
  starred,
  name,
  onToggle,
  className = "",
}: {
  starred: boolean;
  name: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button star-button${starred ? " on" : ""} ${className}`}
      aria-pressed={starred}
      aria-label={`${starred ? "取消标星" : "标星"} ${name}`}
      title={starred ? "取消标星" : "标星"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Star size={18} fill={starred ? "currentColor" : "none"} />
    </button>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="error">
      <AlertCircle size={16} />
      {error}
    </p>
  ) : null;
}
export function TypeBadge({ type }: { type: keyof typeof eventLabels }) {
  const Icon = typeIcons[type];
  return (
    <span className={`badge ${type}`}>
      <Icon size={12} />
      {eventLabels[type]}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-title">
        <div className="eyebrow">
          <Sparkle size={11} />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="button-row">{actions}</div>}
    </div>
  );
}
export function PromptArea({
  value,
  onChange,
  label = "Tag",
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
}) {
  return (
    <label>
      {label}
      <textarea
        className="prompt-text"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </label>
  );
}
export function CharacterPicker({
  data,
  selected,
  onChange,
}: {
  data: Data;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="character-picker">
      <legend>关联角色</legend>
      {data.characters.map((c) => (
        <label key={c.id} className="check-label">
          <input
            type="checkbox"
            checked={selected.includes(c.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, c.id]
                  : selected.filter((id) => id !== c.id),
              )
            }
          />
          {c.name}
        </label>
      ))}
    </fieldset>
  );
}
