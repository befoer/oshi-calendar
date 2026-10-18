import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export type MenuOption<T extends string> = { value: T; label: string };

/**
 * 自绘下拉菜单（替代原生 <select>）：弹出层完全跟随主题，
 * 支持键盘（↑ ↓ Home End 选择，Enter／空格确认，Esc 关闭）。
 */
export function SelectMenu<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  align = "left",
}: {
  label: string;
  icon?: ReactNode;
  value: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => {
    if (open)
      box.current
        ?.querySelector<HTMLElement>('[role="option"][data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    trigger.current?.focus();
  };
  const key = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div className="select-menu" ref={box} onKeyDown={key}>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger${open ? " open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {icon}
        <span>{current.label}</span>
        <ChevronDown size={16} className="chevron" />
      </button>
      {open && (
        <ul
          id={listId}
          className={`select-list ${align}`}
          role="listbox"
          aria-label={label}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              className={o.value === value ? "selected" : ""}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={16} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
