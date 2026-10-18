import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";

/**
 * 模型输入框 + 下拉：可以直接输入，也可以从获取到的模型里选。
 * 获取中显示「正在获取模型…」和加载动画；openKey 每变一次就弹开一次（开始获取、获取完成）。
 */
export function ModelCombobox({
  ariaLabel,
  value,
  onChange,
  models,
  loading,
  openKey,
  placeholder,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  models: string[];
  loading: boolean;
  openKey: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(openKey);
  useEffect(() => {
    if (openKey !== first.current) setOpen(true);
  }, [openKey]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  // 输入内容正好是某个模型时列出全部，否则按输入过滤
  const exact = models.includes(value.trim());
  const shown =
    !value.trim() || exact
      ? models
      : models.filter((m) => m.toLowerCase().includes(value.trim().toLowerCase()));
  return (
    <div className="combo" ref={box}>
      <div className="combo-input">
        <input
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            // 有列表可选时，边输入边展开过滤；没有列表就别弹空面板挡住下面的按钮
            if (models.length || loading) setOpen(true);
          }}
          onFocus={() => (models.length || loading) && setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        />
        <button
          type="button"
          className="combo-toggle"
          aria-label="展开下拉列表"
          onClick={() => setOpen((v) => !v)}
        >
          {loading ? <Loader2 className="spin" size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {open && (
        <div className="combo-list" role="listbox" aria-label={`${ariaLabel}列表`}>
          {loading ? (
            <p className="combo-hint">
              <Loader2 className="spin" size={15} />
              正在获取模型…
            </p>
          ) : !models.length ? (
            <p className="combo-hint">还没有获取到模型，可直接输入模型名称</p>
          ) : !shown.length ? (
            <p className="combo-hint">没有匹配的模型，可直接使用输入的名称</p>
          ) : (
            shown.map((m) => (
              <button
                type="button"
                role="option"
                aria-selected={m === value.trim()}
                key={m}
                className={m === value.trim() ? "selected" : ""}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <span>{m}</span>
                {m === value.trim() && <Check size={14} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
