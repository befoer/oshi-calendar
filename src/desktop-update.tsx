import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";

type Result = Awaited<
  ReturnType<NonNullable<Window["oshiDesktop"]>["checkUpdate"]>
>;

/** 设置「关于」里的版本与在线更新（只在 Electron 桌面版显示）。 */
export function DesktopUpdate() {
  const desktop = window.oshiDesktop;
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    void desktop
      ?.version()
      .then(setVersion)
      .catch(() => {});
    const unsubscribe = desktop?.onUpdate(setResult);
    void desktop
      ?.updateState()
      .then(setResult)
      .catch(() => {});
    return unsubscribe;
  }, [desktop]);
  if (!desktop) return null;
  const check = async () => {
    setChecking(true);
    try {
      setResult(await desktop.checkUpdate());
    } catch {
      setResult({
        status: "error",
        current: version,
        message: "检查更新失败，请重试",
      });
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="setting-row">
      <div>
        <strong>版本</strong>
        <span>
          桌面版 {version || "…"}
          {result?.status === "latest" && " · 已是最新版本"}
          {result?.status === "available" && ` · 有新版本 ${result.latest}`}
          {result?.status === "error" && ` · ${result.message}`}
          {result?.status === "downloading" &&
            ` · 正在下载 ${result.percent ?? 0}%`}
          {result?.status === "ready" && ` · ${result.latest} 已下载`}
        </span>
      </div>
      {result?.status === "ready" ? (
        <button
          className="primary"
          onClick={() => void desktop.installUpdate()}
        >
          重启并安装
        </button>
      ) : result?.status === "downloading" ? (
        <button disabled>
          <Loader2 size={16} className="spin" />
          正在下载
        </button>
      ) : result?.status === "available" && (result.automatic || result.url) ? (
        <button
          className="primary"
          onClick={() =>
            void (result.automatic
              ? desktop.downloadUpdate()
              : desktop.openDownload(result.url!))
          }
        >
          <Download size={16} />
          下载 {result.latest}
        </button>
      ) : (
        <button
          onClick={() => void check()}
          disabled={checking || result?.status === "checking"}
        >
          {checking ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          检查更新
        </button>
      )}
    </div>
  );
}
