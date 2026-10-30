import { useRef, useState } from "react";
import { Check, Download, ImageIcon, Loader2 } from "lucide-react";
import { syntaxLabels, type PromptSyntax } from "./chat-prompts";
import { ModelCombobox } from "./model-combobox";
import { useModelList } from "./use-models";
import {
  defaultCustomBody,
  generateImage,
  loadImageConfig,
  saveImageConfig,
  type ImageConfig,
  type ImageKind,
  type SizeMode,
} from "./image-gen";
import { ErrorText } from "./ui";

const kindHelp: Record<ImageKind, string> = {
  images:
    "OpenAI 风格的图片接口：POST {地址}/images/generations，最常见。地址填到 /v1 为止，例如 https://api.example.com/v1。",
  chat: "用对话接口出图：POST {地址}/chat/completions，模型在回复里给出图片（网址、Markdown 图片或 base64 都能识别）。",
  custom:
    "自己填完整请求地址和请求体模板。模板里的 {{prompt}}、{{model}}、{{size}} 会被替换；返回内容里的图片网址或 base64 会被自动找出来。",
};

/** 设置页「生图接口」：适配不同的生图 API；配置后聊天窗口里就能直接生图。 */
export function ImageSettings({ notify }: { notify: (s: string) => void }) {
  const [config, setConfig] = useState<ImageConfig>(loadImageConfig);
  // 非自定义接口：地址和密钥填完后自动获取模型；自定义接口没有统一的模型列表地址
  const modelList = useModelList(
    config.kind === "custom" ? "" : config.endpoint,
    config.kind === "custom" ? "" : config.key,
  );
  const [busy, setBusy] = useState<"" | "test">("");
  const [error, setError] = useState("");
  const [sample, setSample] = useState("");
  const controller = useRef<AbortController | null>(null);
  const set = (patch: Partial<ImageConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));
  const run = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy("test");
    setError("");
    setSample("");
    try {
      setSample(
        await generateImage(
          config,
          "a small red apple on a white background, simple flat illustration",
          abort.signal,
        ),
      );
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "失败");
    } finally {
      if (controller.current === abort) setBusy("");
    }
  };
  return (
    <section className="settings-section" id="set-image">
      <div className="section-heading">
        <ImageIcon size={18} />
        <h2>生图接口</h2>
      </div>
      <p className="muted">
        配置后，角色聊天窗口里的「生图」按钮会直接用预置提示词（或你输入的内容）出图。各家生图接口不统一，可按下面三种方式适配。
      </p>
      <label>
        接口类型
        <select
          aria-label="生图接口类型"
          value={config.kind}
          onChange={(e) => set({ kind: e.target.value as ImageKind })}
        >
          <option value="images">OpenAI 图片接口（/images/generations）</option>
          <option value="chat">对话接口返回图片（/chat/completions）</option>
          <option value="custom">自定义（地址 + 请求体模板）</option>
        </select>
      </label>
      <p className="muted">{kindHelp[config.kind]}</p>
      {config.kind !== "custom" ? (
        <label>
          生图接口地址
          <input
            value={config.endpoint}
            onChange={(e) => set({ endpoint: e.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </label>
      ) : (
        <>
          <label>
            完整请求地址
            <input
              aria-label="自定义请求地址"
              value={config.customUrl}
              onChange={(e) => set({ customUrl: e.target.value })}
              placeholder="https://api.example.com/v1/images/generations"
            />
          </label>
          <label>
            请求体模板
            <textarea
              className="prompt-text"
              aria-label="请求体模板"
              rows={5}
              spellCheck={false}
              value={config.customBody}
              onChange={(e) => set({ customBody: e.target.value })}
              placeholder={defaultCustomBody}
            />
          </label>
          <label>
            认证方式
            <select
              aria-label="认证方式"
              value={config.authStyle}
              onChange={(e) =>
                set({ authStyle: e.target.value as "bearer" | "x-api-key" })
              }
            >
              <option value="bearer">Authorization: Bearer 密钥</option>
              <option value="x-api-key">x-api-key: 密钥</option>
            </select>
          </label>
        </>
      )}
      <label>
        生图 API Key
        <input
          type="password"
          aria-label="生图 API Key"
          value={config.key}
          onChange={(e) => set({ key: e.target.value })}
          autoComplete="off"
        />
      </label>
      <p className="muted">密钥默认保存在本机浏览器，不进入备份。</p>
      <label>
        生图模型
        <ModelCombobox
          ariaLabel="生图模型"
          value={config.model}
          onChange={(model) => set({ model })}
          models={modelList.models}
          loading={modelList.loading}
          openKey={modelList.openKey}
          placeholder="例如 gpt-image-2"
        />
      </label>
      {config.kind !== "custom" && <ErrorText error={modelList.error} />}
      <label>
        图片比例
        <select
          aria-label="图片比例"
          value={config.sizeMode}
          onChange={(e) => set({ sizeMode: e.target.value as SizeMode })}
        >
          <option value="random">随机比例（3:4、4:3、1:1）</option>
          <option value="3:4">竖图 3:4</option>
          <option value="4:3">横图 4:3</option>
          <option value="1:1">方图 1:1</option>
          <option value="custom">自定义尺寸</option>
          <option value="none">不传尺寸</option>
        </select>
      </label>
      {config.sizeMode === "custom" && (
        <label>
          自定义尺寸
          <input
            aria-label="自定义尺寸"
            value={config.size}
            onChange={(e) => set({ size: e.target.value })}
            placeholder="1024x1024"
          />
        </label>
      )}
      <p className="muted">
        比例会换成接口常用的尺寸：1:1 → 1024x1024，3:4 → 1024x1536，4:3 →
        1536x1024（gpt-image 只支持这三种）。自定义接口的模板里可以用{" "}
        {"{{size}}"} 和 {"{{ratio}}"}。
      </p>
      <label>
        提示词语法
        <select
          aria-label="提示词语法"
          value={config.syntax}
          onChange={(e) => set({ syntax: e.target.value as PromptSyntax })}
        >
          {(Object.keys(syntaxLabels) as PromptSyntax[]).map((k) => (
            <option key={k} value={k}>
              {syntaxLabels[k]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        预置提示词，以及聊天中让角色「拍照」时由 AI
        写的画面描述，都会按这个语法来。
      </p>
      <label>
        提示词前缀（固定加在最前面，可留空）
        <input
          aria-label="提示词前缀"
          value={config.prefix}
          onChange={(e) => set({ prefix: e.target.value })}
          placeholder="例如 masterpiece, best quality"
        />
      </label>
      <label>
        提示词后缀（固定加在最后面，可留空）
        <input
          aria-label="提示词后缀"
          value={config.suffix}
          onChange={(e) => set({ suffix: e.target.value })}
          placeholder="例如 anime style, soft colors"
        />
      </label>
      <ErrorText error={error} />
      {sample && (
        <img className="chat-image" src={sample} alt="测试生成的图片" />
      )}
      <div className="button-row">
        <button
          className="primary"
          onClick={() => {
            saveImageConfig(config);
            notify("生图接口设置已保存");
          }}
        >
          <Check size={16} />
          保存生图配置
        </button>
        {config.kind !== "custom" && (
          <button
            disabled={modelList.loading}
            onClick={() => void modelList.fetchNow(true)}
          >
            {modelList.loading ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}
            获取模型
          </button>
        )}
        <button disabled={busy !== ""} onClick={() => void run()}>
          {busy === "test" ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ImageIcon size={16} />
          )}
          测试生图
        </button>
      </div>
    </section>
  );
}
