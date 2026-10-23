import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";

type Result = Awaited<ReturnType<NonNullable<Window["oshiDesktop"]>["checkUpdate"]>>;

/** 设置「关于」里的版本与在线更新（只在 Electron 桌面版显示）。 */
export function DesktopUpdate() {
  const desktop = window.oshiDesktop;
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    void desktop?.version().then(setVersion).catch(() => {});
  }, [desktop]);
  if (!desktop) return null;
  const check = async () => {
    setChecking(true);
    try {
      setResult(await desktop.checkUpdate());
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
        </span>
      </div>
      {result?.status === "available" && result.url ? (
        <button className="primary" onClick={() => void desktop.openDownload(result.url!)}>
          <Download size={16} />
          下载 {result.latest}
        </button>
      ) : (
        <button onClick={() => void check()} disabled={checking}>
          {checking ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          检查更新
        </button>
      )}
    </div>
  );
}
