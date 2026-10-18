// Assemble tool arguments only after a complete stream. Partial JSON never runs.
export class AIStreamError extends Error {
  readonly retryNonStreaming: boolean;
  constructor(error: unknown) {
    const value =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    const code = [value.code, value.type, value.status]
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join(" ")
      .toLowerCase();
    const hint =
      typeof value.message === "string" ? value.message.toLowerCase() : "";
    const category = `${code} ${hint}`;
    const auth =
      /authentication|unauthorized|invalid_api_key|permission|\b40[13]\b/.test(
        category,
      );
    const rate = /rate.?limit|quota|insufficient|\b429\b/.test(category);
    const context =
      /context.?length|maximum context|too many tokens|token limit/.test(
        category,
      );
    super(
      auth
        ? "AI 上游流式响应鉴权失败，请检查密钥及模型权限；未执行本轮工具"
        : rate
          ? "AI 上游流式响应被限流或额度不足，请稍后重试；未执行本轮工具"
          : context
            ? "AI 上游提示上下文过长，请结束本次操作后缩短请求或切换模型；未执行本轮工具"
            : "AI 上游流式响应返回错误，未执行本轮工具；可切换模型后继续",
    );
    this.name = "AIStreamError";
    this.retryNonStreaming = !auth && !rate && !context;
  }
}
export const hasVisibleReply = (text: string) =>
  text
    .replace(/&(?:nbsp|#(?:x0*20|0*32));/gi, " ")
    .replace(/[\s\u200b\ufeff]/g, "").length > 0;
export async function readCompletionStream(
  response: Response,
  onText: (text: string) => void,
  signal?: AbortSignal,
  idleTimeoutMs = 90000,
) {
  if (!response.body) throw new Error("AI 接口没有返回响应流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    content = "",
    finished = false,
    done = false;
  const calls = new Map<number, any>();
  function event(block: string) {
    const raw = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!raw) return;
    if (raw === "[DONE]") {
      done = true;
      return;
    }
    if (done) return;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("AI 流式数据格式无效，未执行本轮工具");
    }
    if (data.error) throw new AIStreamError(data.error);
    const choice = data.choices?.find(
      (c: any) => c.index === 0 || c.index === undefined,
    );
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") {
      content += delta.content;
      onText(content);
    }
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 50)
        throw new Error("AI 流式工具索引无效");
      const call = calls.get(part.index) ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (part.id) call.id += part.id;
      if (part.type && part.type !== "function")
        throw new Error("不支持此工具类型");
      call.function.name += part.function?.name ?? "";
      call.function.arguments += part.function?.arguments ?? "";
      calls.set(part.index, call);
    }
    if (choice.finish_reason) {
      if (!["stop", "tool_calls"].includes(choice.finish_reason))
        throw new Error("AI 回复未完整生成，未执行本轮工具，请缩短请求后重试");
      finished = true;
    }
  }
  try {
    while (!done) {
      signal?.throwIfAborted();
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleTimer = setTimeout(
            () =>
              reject(new DOMException("响应流长时间无数据", "TimeoutError")),
            idleTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(idleTimer));
      buffer += decoder.decode(part.value, { stream: !part.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (part.done) {
        if (buffer.trim()) event(buffer);
        break;
      }
    }
    signal?.throwIfAborted();
    if (!finished) throw new Error("AI 响应流意外中断，未执行本轮工具，请重试");
    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => c);
    if (
      toolCalls.some((c) => !c.id || !c.function.name || !c.function.arguments)
    )
      throw new Error("AI 流式工具信息不完整，未执行本轮工具");
    return {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
