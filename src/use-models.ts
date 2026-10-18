import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModels } from "./ai";

/** 地址和密钥看起来填完整了才自动去拿模型列表（填到一半不要乱请求）。 */
export const looksComplete = (endpoint: string, key: string) =>
  key.trim().length >= 8 &&
  /^https?:\/\/(?:localhost|\[[0-9a-f:]+\]|[^\s/:]+\.[^\s/:]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(
    endpoint.trim(),
  );

/**
 * 模型列表：地址和密钥填完后稍等片刻自动获取；点「获取模型」则立刻获取，
 * 并通过 openKey 通知下拉框在「开始」和「完成」时各弹开一次（先显示加载中，拿到后直接展开选择）。
 */
export function useModelList(endpoint: string, key: string, delay = 900) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ endpoint, key });
  latest.current = { endpoint, key };

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
  }, []);
  const fetchNow = useCallback(
    async (manual: boolean): Promise<string[] | null> => {
      clearTimeout(timer.current);
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setError("");
      if (manual) setOpenKey((n) => n + 1);
      try {
        const list = await fetchModels(latest.current, abort.signal);
        if (abort.signal.aborted) return null;
        setModels(list);
        if (manual) setOpenKey((n) => n + 1);
        return list;
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "获取模型失败");
        return null;
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setLoading(false);
        }
      }
    },
    [],
  );
  useEffect(() => {
    cancel();
    setModels([]);
    setError("");
    if (looksComplete(endpoint, key))
      timer.current = setTimeout(() => void fetchNow(false), delay);
    return cancel;
  }, [endpoint, key, delay, cancel, fetchNow]);
  return { models, loading, error, openKey, fetchNow, cancel };
}
