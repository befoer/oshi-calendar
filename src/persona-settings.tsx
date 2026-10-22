import { useState } from "react";
import { Check, UserRound } from "lucide-react";
import { loadPersona, savePersona } from "./chat-persona";

/** 设置页「聊天中的我」：称呼和简介，聊天时作为资料告诉扮演角色的 AI（只存在本机浏览器）。 */
export function PersonaSettings({ notify }: { notify: (s: string) => void }) {
  const [persona, setPersona] = useState(loadPersona);
  return (
    <section className="settings-section" id="set-persona">
      <div className="section-heading">
        <UserRound size={18} />
        <h2>聊天中的我</h2>
      </div>
      <p className="muted">
        和角色聊天时，AI 会用这里的称呼叫你，并知道一点你的情况。两项都可以留空，只存在本机浏览器里。
      </p>
      <label>
        我的称呼
        <input
          aria-label="我的称呼"
          value={persona.name}
          onChange={(e) => setPersona({ ...persona, name: e.target.value })}
          placeholder="例如：主人"
        />
      </label>
      <label>
        我的简介（人设）
        <textarea
          aria-label="我的简介"
          rows={3}
          value={persona.about}
          onChange={(e) => setPersona({ ...persona, about: e.target.value })}
          placeholder="例如：喜欢画画的大学生，最近在赶生日贺图"
        />
      </label>
      <div className="button-row">
        <button
          className="primary"
          onClick={() => {
            savePersona(persona);
            notify("聊天中的我已保存");
          }}
        >
          <Check size={16} />
          保存
        </button>
      </div>
    </section>
  );
}
