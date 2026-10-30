"""从成片里挑镜头剪出竖屏短版（1080×1920）：上方标题，中间是横屏画面，背景为同画面虚化。

前提：build.py 已输出 成片/推日-宣传片.mp4，素材/render/timeline.json 存在。
用法：python 宣传视频/制作/short.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
FILM = VIDEO / "成片" / "推日-宣传片.mp4"
OUT = VIDEO / "成片" / "推日-竖屏短版.mp4"
FONT = "C\\:/Windows/Fonts/msyhbd.ttc"

# 挑选的镜头（按顺序），以及片尾卡取最后几秒
PICK = ["0-1", "0-2", "1-1", "2-1", "3-2", "7-1", "7-2"]
TAIL = ("8-2", 3.2)


def main():
    cfg = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
    tl = json.loads((VIDEO / "素材" / "render" / "timeline.json").read_text(encoding="utf-8"))
    order = [s["id"] for s in cfg["segments"]]
    off, t, shots = {}, 0.0, {}
    for sid in order:
        off[sid] = t
        for sh in tl[sid]["shots"]:
            shots[sh["id"]] = (t + sh["t0"], sh["dur"])
        t += tl[sid]["length"]
    ranges = [shots[i] for i in PICK]
    a, d = shots[TAIL[0]]
    ranges.append((a + d - TAIL[1], TAIL[1]))
    # 相邻镜头合并成一段，减少接缝
    merged = []
    for s, d in ranges:
        if merged and abs(merged[-1][0] + merged[-1][1] - s) < 0.05:
            merged[-1] = (merged[-1][0], merged[-1][1] + d)
        else:
            merged.append((s, d))
    parts = []
    for i, (s, d) in enumerate(merged):
        parts.append(
            f"[0:v]trim=start={s:.3f}:duration={d:.3f},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={s:.3f}:duration={d:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:d=0.06,afade=t=out:st={max(0, d - 0.08):.3f}:d=0.08[a{i}]"
        )
    n = len(merged)
    concat = "".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[cv][ca]"
    layout = (
        "[cv]split[bg0][fg0];"
        "[bg0]scale=-2:1920,crop=1080:1920,boxblur=30:3,eq=brightness=0.06:saturation=0.8[bg];"
        "[fg0]scale=1080:-2[fg];"
        "[bg][fg]overlay=0:(H-h)/2+40[ov];"
        f"[ov]drawbox=x=60:y=250:w=960:h=260:color=white@0.88:t=fill,"
        f"drawtext=fontfile='{FONT}':text='再也不错过':fontsize=96:fontcolor=0x2d2a63:x=(w-tw)/2:y=275,"
        f"drawtext=fontfile='{FONT}':text='推的生日':fontsize=96:fontcolor=0xf472b6:x=(w-tw)/2:y=385,"
        f"drawtext=fontfile='{FONT}':text='推日 · 角色创作日历　完整版见主页':fontsize=40:fontcolor=0x2d2a63:x=(w-tw)/2:y=h-330[outv]"
    )
    graph = ";".join(parts) + ";" + concat + ";" + layout
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(FILM), "-filter_complex", graph, "-map", "[outv]", "-map", "[ca]",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "60",
         "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(OUT)],
        check=True,
    )
    print(OUT, f"{sum(d for _, d in merged):.1f}s")


if __name__ == "__main__":
    main()
