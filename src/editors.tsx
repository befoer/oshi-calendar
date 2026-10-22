import { useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  ImagePlus,
  Move,
  Search,
  Trash2,
} from "lucide-react";
import { put } from "./store";
import { syncBirthdays } from "./bangumi";
import { quietNetwork } from "./external-network";
import type { Character, CustomEvent, Data, Task } from "./domain";
import {
  Avatar,
  CharacterPicker,
  ErrorText,
  Modal,
  PromptArea,
  StarButton,
  statusLabels,
} from "./ui";
import { TagField } from "./tag-field";

const asciiName = (s: string) => /[a-z]/i.test(s) && /^[\x20-\x7e]+$/.test(s);
export const defaultTag = (c: Character) =>
  c.presets.find((p) => p.id === c.defaultPresetId)?.positive ?? "";
export const withTag = (c: Character, positive: string): Character => ({
  ...c,
  presets: c.presets.map((p) =>
    p.id === c.defaultPresetId ? { ...p, positive } : p,
  ),
});
/** 用来在线查 Tag 的名字：英文别名、已有 Tag 的角色名部分优先，最后是显示名。 */
export const tagTerms = (c: Character) => {
  const fromTag = defaultTag(c)
    .split(",")[0]
    .replace(/\\/g, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
  return [
    ...c.aliases.filter(asciiName),
    ...(asciiName(fromTag) ? [fromTag] : []),
    c.name,
    ...c.aliases.filter((a) => !asciiName(a)),
  ];
};


const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
type Pose = { x: number; y: number; z: number };
const poseOf = (c: Character): Pose => ({
  x: c.avatarX ?? 50,
  y: c.avatarY ?? 18,
  z: c.avatarZoom ?? 1,
});
const withPose = (c: Character, pose: Pose): Character => ({
  ...c,
  avatarX: pose.x,
  avatarY: pose.y,
  avatarZoom: pose.z,
});

/**
 * 编辑器里的头像框：鼠标移到图片上，右上角出现「调整位置」按钮；
 * 点开后在图片上拖动即可移动画面（顶部空隙太大时拖上去），也可以缩放，
 * 「保存位置」确认、「取消」放弃。
 */
function AvatarFrame({
  value,
  draft,
  onDraft,
  onSave,
}: {
  value: Character;
  /** 非空表示正在调整，里面是还没确认的位置 */
  draft: Pose | null;
  onDraft: (pose: Pose | null) => void;
  onSave: (pose: Pose) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; pose: Pose } | null>(null);
  const shown = draft ? withPose(value, draft) : value;
  /** 图片「一整段可移动距离」对应多少像素：object-fit: cover 后超出画框的部分 */
  const travel = () => {
    const rect = box.current?.getBoundingClientRect();
    const img = box.current?.querySelector("img");
    if (!rect) return { x: 100, y: 100 };
    if (!img?.naturalWidth) return { x: rect.width, y: rect.height };
    const scale = Math.max(
      rect.width / img.naturalWidth,
      rect.height / img.naturalHeight,
    );
    return {
      x: Math.max(img.naturalWidth * scale - rect.width, 24),
      y: Math.max(img.naturalHeight * scale - rect.height, 24),
    };
  };
  const move = (from: Pose, dx: number, dy: number) => {
    const t = travel();
    const z = Math.max(from.z, 1);
    onDraft({
      ...from,
      x: clamp(Math.round(from.x - (dx / t.x / z) * 100), 0, 100),
      y: clamp(Math.round(from.y - (dy / t.y / z) * 100), 0, 100),
    });
  };
  return (
    <div className={`avatar-frame${draft ? " adjusting" : ""}`}>
      <div
        ref={box}
        className="frame-image"
        tabIndex={draft ? 0 : -1}
        role={draft ? "group" : undefined}
        aria-label={draft ? "头像预览，拖动图片调整位置" : undefined}
        onPointerDown={(e) => {
          if (!draft) return;
          box.current?.setPointerCapture(e.pointerId);
          // 拖动时不让浏览器选中图片（选中会盖上一层蓝色）
          e.preventDefault();
          drag.current = { x: e.clientX, y: e.clientY, pose: draft };
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (start) move(start.pose, e.clientX - start.x, e.clientY - start.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = { ArrowUp: [0, -6], ArrowDown: [0, 6], ArrowLeft: [-6, 0], ArrowRight: [6, 0] }[
            e.key
          ];
          if (!draft || !step) return;
          e.preventDefault();
          const t = travel();
          move(draft, (step[0] * t.x) / 100, (step[1] * t.y) / 100);
        }}
      >
        <Avatar character={shown} size="cover" />
      </div>
      {value.avatarUrl && !draft && (
        <button
          type="button"
          className="frame-edit"
          aria-label="调整图片位置"
          title="调整图片位置"
          onClick={() => onDraft(poseOf(value))}
        >
          <Move size={15} />
        </button>
      )}
      {draft && (
        <div className="frame-overlay">
          <div className="frame-bar">
            <button
              type="button"
              className="primary"
              onClick={() => onSave(draft)}
            >
              保存位置
            </button>
            <button type="button" onClick={() => onDraft(null)}>
              取消
            </button>
          </div>
          <p className="frame-hint">拖动图片以调整位置</p>
          <label className="frame-zoom">
            <span>缩放</span>
            <input
              type="range"
              aria-label="缩放"
              min="1"
              max="3"
              step="0.05"
              value={draft.z}
              onChange={(e) => onDraft({ ...draft, z: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function CharacterEditor({
  character,
  onClose,
  onSaved,
  onBangumi,
  onDelete,
}: {
  character: Character;
  onClose: () => void;
  onSaved: (record: Character) => void;
  onBangumi: (record: Character) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState<Character>(structuredClone(character)),
    [error, setError] = useState("");
  /** 头像正在调整、还没点「保存位置」的位置；直接点「保存角色」也会一起保存 */
  const [pose, setPose] = useState<Pose | null>(null);
  const avatarFile = useRef<HTMLInputElement>(null);
  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > 3 * 1024 * 1024
    ) {
      setError("请选择 3 MB 以内的 PNG、JPEG、WebP 或 GIF 图片");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setValue((v) => ({ ...v, avatarUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  };
  const save = async () => {
    const record = pose ? withPose(value, pose) : value;
    try {
      await put("characters", record, `保存角色：${record.name}`);
      if (
        (record.bangumiId || record.anilistId) &&
        ((!record.birthday && record.birthdayConfidence !== "none") ||
          !record.avatarUrl) &&
        navigator.onLine
      )
        void quietNetwork(() => syncBirthdays(true)).catch(() => {});
      onSaved(record);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };
  const list = (text: string) =>
    text
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <Modal
      title={character.name ? `编辑角色 · ${character.name}` : "添加角色"}
      onClose={onClose}
      wide
    >
      <div className="modal-body editor-grid">
        <section>
          <div className="editor-avatar">
            <AvatarFrame
              value={value}
              draft={pose}
              onDraft={setPose}
              onSave={(next) => {
                setValue((v) => withPose(v, next));
                setPose(null);
              }}
            />
            <label className="url-field">
              头像 URL
              <input
                value={value.avatarUrl.startsWith("data:") ? "" : value.avatarUrl}
                onChange={(e) =>
                  setValue({ ...value, avatarUrl: e.target.value })
                }
                placeholder={
                  value.avatarUrl.startsWith("data:")
                    ? "已保存在本机，可粘贴新地址替换"
                    : "https://…"
                }
              />
            </label>
          </div>
          <button onClick={() => avatarFile.current?.click()}>
            <ImagePlus size={16} />
            上传本地头像
          </button>
          <input
            ref={avatarFile}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void uploadAvatar(e.target.files?.[0])}
          />
          {value.birthdaySource && (
            <div className="source-note">
              <strong>生日资料来源</strong>
              <p>{value.birthdaySource}</p>
              {value.bangumiId && (
                <a
                  href={`https://bgm.tv/character/${value.bangumiId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看 Bangumi 原条目
                  <ExternalLink size={13} />
                </a>
              )}
              {value.anilistId && (
                <a
                  href={`https://anilist.co/character/${value.anilistId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看 AniList 原条目
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          )}
          <label>
            角色名称
            <input
              autoFocus
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </label>
          <label>
            别名
            <input
              value={value.aliases.join("、")}
              onChange={(e) =>
                setValue({ ...value, aliases: list(e.target.value) })
              }
            />
          </label>
          <label>
            作品
            <input
              value={value.works.join("、")}
              onChange={(e) =>
                setValue({ ...value, works: list(e.target.value) })
              }
            />
          </label>
          <div className="form-row">
            <label>
              生日月
              <input
                type="number"
                min="1"
                max="12"
                disabled={value.birthdayConfidence === "none"}
                value={value.birthday?.month ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    birthday: e.target.value
                      ? {
                          month: Number(e.target.value),
                          day: value.birthday?.day ?? 1,
                        }
                      : null,
                    birthdayConfidence: e.target.value
                      ? "confirmed"
                      : "unknown",
                  })
                }
              />
            </label>
            <label>
              生日日
              <input
                type="number"
                min="1"
                max="31"
                disabled={value.birthdayConfidence === "none"}
                value={value.birthday?.day ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    birthday: e.target.value
                      ? {
                          month: value.birthday?.month ?? 1,
                          day: Number(e.target.value),
                        }
                      : null,
                    birthdayConfidence: e.target.value
                      ? "confirmed"
                      : "unknown",
                  })
                }
              />
            </label>
            <label>
              提前提醒
              <input
                type="number"
                min="0"
                max="365"
                value={value.reminderDays ?? ""}
                placeholder="默认"
                onChange={(e) =>
                  setValue({
                    ...value,
                    reminderDays: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
              <small>天</small>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={value.birthdayConfidence === "none"}
              checked={value.birthdayConfidence === "confirmed"}
              onChange={(e) =>
                setValue({
                  ...value,
                  birthdayConfidence: e.target.checked
                    ? "confirmed"
                    : "uncertain",
                })
              }
            />
            生日已核实
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.birthdayConfidence === "none"}
              onChange={(e) =>
                setValue({
                  ...value,
                  birthday: null,
                  birthdayConfidence: e.target.checked ? "none" : "unknown",
                })
              }
            />
            无生日
          </label>
          <label>
            备注
            <textarea
              rows={3}
              value={value.notes}
              onChange={(e) => setValue({ ...value, notes: e.target.value })}
            />
          </label>
        </section>
        <section className="tag-section">
          <div className="section-heading tight">
            <h3>生图 Tag</h3>
            <label className="check-label star-check">
              <StarButton
                starred={value.starred}
                name={value.name || "角色"}
                onToggle={() => setValue({ ...value, starred: !value.starred })}
              />
              {value.starred ? "已标星" : "标星"}
            </label>
          </div>
          <p className="muted">
            Tag 只放角色标签本身，各处的复制按钮复制的就是它；人物特征单独保存，不会被复制。可以手动填写，也可以按角色名自动获取。
          </p>
          <TagField
            terms={tagTerms(value)}
            value={{ tag: defaultTag(value), traits: value.traits }}
            onChange={({ tag, traits }) =>
              setValue((v) => ({ ...withTag(v, tag), traits }))
            }
          />
          <details className="chat-setup" open={!!(value.chatGreeting || value.chatPersonality || value.chatExamples)}>
            <summary>聊天设定（开场白、性格补充、示例对话）</summary>
            <p className="muted">
              和这个角色聊天时带给 AI，都可以留空。示例对话每行写一句，用「我：」「{value.name || "角色"}：」开头。
            </p>
            <label>
              开场白（打开聊天时角色先说的话）
              <textarea
                aria-label="开场白"
                rows={2}
                value={value.chatGreeting}
                onChange={(e) => setValue({ ...value, chatGreeting: e.target.value })}
              />
            </label>
            <label>
              性格补充
              <textarea
                aria-label="性格补充"
                rows={3}
                value={value.chatPersonality}
                onChange={(e) => setValue({ ...value, chatPersonality: e.target.value })}
                placeholder="例如：嘴硬心软，被夸会脸红；爱吃甜食"
              />
            </label>
            <label>
              示例对话
              <textarea
                aria-label="示例对话"
                rows={4}
                value={value.chatExamples}
                onChange={(e) => setValue({ ...value, chatExamples: e.target.value })}
                placeholder={"我：今天好冷\n角色：哼，才不是担心你，披上这个。"}
              />
            </label>
          </details>
        </section>
      </div>
      <ErrorText error={error} />
      <footer>
        <div className="footer-left">
          {character.name && (
            <button className="danger-quiet" onClick={onDelete}>
              <Trash2 size={16} />
              删除角色
            </button>
          )}
          <button
            onClick={() => onBangumi(value)}
            disabled={!value.name.trim()}
          >
            <Search size={16} />
            获取头像和生日
          </button>
        </div>
        <div>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()}>
            <Check size={16} />
            保存角色
          </button>
        </div>
      </footer>
    </Modal>
  );
}

export function EventForm({
  event,
  onClose,
  onSaved,
  embedded = false,
}: {
  event: CustomEvent;
  onClose: () => void;
  onSaved: () => void;
  embedded?: boolean;
}) {
  const [value, setValue] = useState<CustomEvent>(structuredClone(event)),
    [error, setError] = useState("");
  const save = async () => {
    try {
      await put("events", value, `保存节日：${value.title}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };
  return (
    <>
      <div className="modal-body">
        <label>
          标题
          <input
            autoFocus={!embedded}
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
            placeholder="例如：角色周年纪念"
          />
        </label>
        <label>
          重复方式
          <select
            value={value.recurrence}
            onChange={(e) =>
              setValue({
                ...value,
                recurrence: e.target.value as CustomEvent["recurrence"],
              })
            }
          >
            <option value="once">仅此一次（公历）</option>
            <option value="solar">每年重复（公历）</option>
            <option value="lunar">每年重复（农历）</option>
          </select>
        </label>
        {value.recurrence === "once" ? (
          <label>
            日期
            <input
              type="date"
              value={value.date}
              onChange={(e) =>
                setValue({
                  ...value,
                  date: e.target.value,
                  month: Number(e.target.value.slice(5, 7)),
                  day: Number(e.target.value.slice(8)),
                })
              }
            />
          </label>
        ) : (
          <div className="form-row">
            <label>
              月份
              <input
                type="number"
                min="1"
                max="12"
                value={value.month}
                onChange={(e) =>
                  setValue({ ...value, month: Number(e.target.value) })
                }
              />
            </label>
            <label>
              日期
              <input
                type="number"
                min="1"
                max="31"
                value={value.day}
                onChange={(e) =>
                  setValue({ ...value, day: Number(e.target.value) })
                }
              />
            </label>
          </div>
        )}
        <label>
          提前提醒
          <input
            type="number"
            min="0"
            max="365"
            placeholder="使用默认设置"
            value={value.reminderDays ?? ""}
            onChange={(e) =>
              setValue({
                ...value,
                reminderDays: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
          <small>天</small>
        </label>
        <label>
          备注
          <textarea
            rows={3}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
          />
        </label>
      </div>
      <ErrorText error={error} />
      <footer>
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={() => void save()}>
          <Check size={16} />
          保存节日
        </button>
      </footer>
    </>
  );
}
export function EventEditor(props: {
  event: CustomEvent;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Modal title="编辑自定义节日" onClose={props.onClose}>
      <EventForm {...props} />
    </Modal>
  );
}

export function TaskEditor({
  task,
  data,
  onClose,
  onSaved,
  onDelete,
}: {
  task: Task;
  data: Data;
  onClose: () => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState<Task>(structuredClone(task)),
    [error, setError] = useState("");
  const save = async () => {
    try {
      await put("tasks", value, `保存任务：${value.title}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };
  return (
    <Modal
      title={task.title ? "编辑创作任务" : "新建创作任务"}
      onClose={onClose}
    >
      <div className="modal-body">
        <label>
          创作主题
          <input
            autoFocus
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
            placeholder="例如：夏日海边插画"
          />
        </label>
        <div className="form-row">
          <label>
            目标日期
            <input
              type="date"
              value={value.date}
              onChange={(e) => setValue({ ...value, date: e.target.value })}
            />
          </label>
          <label>
            状态
            <select
              value={value.status}
              onChange={(e) =>
                setValue({ ...value, status: e.target.value as Task["status"] })
              }
            >
              {Object.entries(statusLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CharacterPicker
          data={data}
          selected={value.characterIds}
          onChange={(characterIds) => setValue({ ...value, characterIds })}
        />
        <PromptArea
          label="Tag"
          value={value.positive}
          onChange={(positive) => setValue({ ...value, positive })}
        />
        <label>
          备注
          <textarea
            rows={3}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
          />
        </label>
      </div>
      <ErrorText error={error} />
      <footer>
        <div className="footer-left">
          {task.title && (
            <button className="danger-quiet" onClick={onDelete}>
              <Trash2 size={16} />
              删除任务
            </button>
          )}
        </div>
        <div>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()}>
            <Check size={16} />
            保存任务
          </button>
        </div>
      </footer>
    </Modal>
  );
}
