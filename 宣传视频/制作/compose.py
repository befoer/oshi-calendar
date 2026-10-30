"""逐段合成画面：录屏帧 → 圆角窗口 + 推镜 + 花字 + 字幕 + 段落转场，输出 素材/render/seg-<段>.mp4（无声）。

同时输出 素材/render/timeline.json（每个镜头的起止时间、配音起点、点击时间），给 build.py 混音用。
用法：python 宣传视频/制作/compose.py [段落id…] [--preview]
  --preview：30 帧、半分辨率，快速检查用
"""
import json
import math
import re
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
REC = VIDEO / "素材" / "rec"
OUT = VIDEO / "素材" / "render"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT = "C:/Windows/Fonts/msyh.ttc"

W, H = 1920, 1080
VIEW_W, VIEW_H = 1600, 900  # 应用录制视口（CSS 像素）
MARGIN = 48
WIN = (MARGIN, MARGIN - 12, W - 2 * MARGIN, (W - 2 * MARGIN) * 9 // 16)  # x, y, w, h
RADIUS = 22

INDIGO = (90, 85, 216)
INDIGO_DARK = (40, 34, 110)
PINK = (244, 114, 182)
WHITE = (255, 255, 255)

args = sys.argv[1:]
PREVIEW = "--preview" in args
FPS = 30 if PREVIEW else 60
SCALE = 0.5 if PREVIEW else 1.0
only = [a for a in args if not a.startswith("--")]


def ease(p: float) -> float:
    p = max(0.0, min(1.0, p))
    return 3 * p * p - 2 * p * p * p


def ease_out_back(p: float) -> float:
    p = max(0.0, min(1.0, p))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2


# ---------------- 静态素材 ----------------
@lru_cache(None)
def font(path: str, size: int):
    return ImageFont.truetype(path, size)


def make_background() -> Image.Image:
    """薰衣草渐变底 + 两团柔光。"""
    bg = Image.new("RGB", (W, H))
    px = bg.load()
    a, b = (238, 235, 250), (226, 230, 248)
    for y in range(H):
        for x in range(0, W, 4):
            t = (x / W * 0.6 + y / H * 0.4)
            c = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
            for dx in range(4):
                px[x + dx, y] = c
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((-300, -350, 700, 450), fill=(244, 114, 182, 60))
    d.ellipse((1300, 650, 2300, 1450), fill=(120, 115, 230, 55))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    bg = Image.alpha_composite(bg.convert("RGBA"), glow)
    return bg


@lru_cache(None)
def window_layers():
    x, y, w, h = WIN
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + 14, x + w, y + h + 14), RADIUS, fill=(40, 30, 110, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    base = Image.alpha_composite(make_background(), shadow)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), RADIUS, fill=255)
    border = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle((x, y, x + w - 1, y + h - 1), RADIUS, outline=(255, 255, 255, 170), width=2)
    return base, mask, border


# ---------------- 镜头数据 ----------------
class Clip:
    """一个录制好的镜头：按成片时间取帧，并给出推镜区域。"""

    def __init__(self, shot_id: str, kind: str, speed: float = 1.0):
        self.id = shot_id
        self.kind = kind
        self.speed = speed  # >1 表示在慢放还原之外再加速（用于比配音长太多的镜头）
        d = REC / shot_id
        self.dir = d
        m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        self.slow = m.get("slow", 4)
        self.start = m["start"]
        self.cuts = sorted(m.get("cuts", []))
        self.frames = []  # (成片时间, 文件)
        for f in m["frames"]:
            if any(a <= f["t"] < b for a, b in self.cuts):
                continue
            self.frames.append((self.ft(f["t"]), f["file"]))
        self.length = self.ft(m["marks"][-1]["t"])
        self.clicks = [self.ft(k["t"]) for k in m["marks"] if k["name"] == "click"]
        self.keys = [self.ft(k["t"]) for k in m["marks"] if k["name"] == "key"]
        self.zooms = [(self.ft(z["t"]), z["rect"], z["dur"] / speed) for z in m.get("zooms", [])]
        self.times = [t for t, _ in self.frames]

    def ft(self, t: float) -> float:
        """真实时间 → 成片时间（去掉剪掉的等待，再除以慢放倍数）。"""
        cut = sum(min(b, t) - a for a, b in self.cuts if a < t)
        return (t - self.start - cut) / self.slow / self.speed

    def frame_at(self, t: float) -> str:
        import bisect

        i = bisect.bisect_right(self.times, t) - 1
        return self.frames[max(0, i)][1]

    def camera(self, t: float):
        """当前推镜区域（视口 CSS 像素 x, y, w, h）。"""
        full = (0.0, 0.0, float(VIEW_W), float(VIEW_H))
        cur = full
        for zt, rect, dur in self.zooms:
            if t < zt:
                break
            target = fit_rect(rect) if rect else full
            p = ease((t - zt) / max(dur, 1e-3))
            cur = tuple(cur[i] + (target[i] - cur[i]) * p for i in range(4))
        return cur


def fit_rect(rect):
    x, y, w, h = rect
    cx, cy = x + w / 2, y + h / 2
    if w / h > 16 / 9:
        h = w * 9 / 16
    else:
        w = h * 16 / 9
    w, h = min(w, VIEW_W), min(h, VIEW_H)
    x = min(max(cx - w / 2, 0), VIEW_W - w)
    y = min(max(cy - h / 2, 0), VIEW_H - h)
    return (x, y, w, h)


@lru_cache(maxsize=6)
def load_frame(path: str) -> Image.Image:
    return Image.open(path).convert("RGB")


# ---------------- 文字 ----------------
def text_size(fnt, text):
    b = fnt.getbbox(text)
    return b[2] - b[0], b[3] - b[1], b[1]


def pill(text, size=40, fg=WHITE, bg=INDIGO, pad=(30, 16), radius=None, fnt_path=FONT_BOLD, outline=None):
    f = font(fnt_path, size)
    tw, th, top = text_size(f, text)
    w, h = tw + pad[0] * 2, th + pad[1] * 2
    img = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 26, 20 + w, 26 + h), radius or h // 2, fill=(30, 20, 90, 70))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(9)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((20, 20, 20 + w, 20 + h), radius or h // 2, fill=bg, outline=outline, width=3 if outline else 0)
    d.text((20 + pad[0], 20 + pad[1] - top), text, font=f, fill=fg)
    return img


@lru_cache(None)
def flower_img(text: str, style: str):
    if style == "big":
        return pill(text, 76, fg=WHITE, bg=PINK, pad=(48, 26))
    if style == "note":
        return pill(text, 26, fg=INDIGO_DARK, bg=(255, 255, 255, 235), pad=(20, 10), fnt_path=FONT)
    if any(k in text for k in ("生日", "错过", "一眼", "瞎编")):
        return pill(text, 44, fg=WHITE, bg=PINK)
    return pill(text, 44, fg=WHITE, bg=INDIGO)


@lru_cache(None)
def subtitle_img(text: str):
    f = font(FONT_BOLD, 46)
    tw, th, top = text_size(f, text)
    pad = (28, 14)
    img = Image.new("RGBA", (tw + pad[0] * 2, th + pad[1] * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, img.width - 1, img.height - 1), 16, fill=(24, 20, 60, 175))
    d.text((pad[0], pad[1] - top), text, font=f, fill=WHITE)
    return img


@lru_cache(None)
def feature_img(index: int, total: int, name: str):
    f1, f2 = font(FONT_BOLD, 30), font(FONT_BOLD, 50)
    num = f"{index:02d} / {total:02d}"
    w1, h1, t1 = text_size(f1, num)
    w2, h2, t2 = text_size(f2, name)
    w = max(w1, w2) + 64
    h = h1 + h2 + 70
    img = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 28, 20 + w, 28 + h), 24, fill=(30, 20, 90, 80))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((20, 20, 20 + w, 20 + h), 24, fill=(255, 255, 255, 245))
    d.rounded_rectangle((20, 20, 30, 20 + h), 5, fill=PINK)
    d.text((52, 44 - t1), num, font=f1, fill=PINK)
    d.text((52, 44 + h1 + 14 - t2), name, font=f2, fill=INDIGO_DARK)
    return img


def split_subtitles(narr: str):
    """按标点切成字幕块（显示时去掉句末标点，保留问号）。"""
    parts = re.split(r"(?<=[，。？！：；])|——", narr)
    chunks = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if chunks and len(re.sub(r"\W", "", p)) <= 3 and len(chunks[-1]) + len(p) <= 22:
            chunks[-1] += p
        else:
            chunks.append(p)
    # 太长的再从中间的顿号切开
    out = []
    for c in chunks:
        if len(c) > 22 and "、" in c:
            mid = c.index("、", len(c) // 3) + 1
            out += [c[:mid], c[mid:]]
        else:
            out.append(c)
    return out


def subtitle_track(narr: str, words: list, dur: float):
    """返回 [(开始, 结束, 文字)]，时间相对配音起点。"""
    chunks = split_subtitles(narr)
    clean = lambda s: re.sub(r"[\W_]", "", s)
    total = sum(len(clean(c)) for c in chunks) or 1
    # 配音字词的累积字数 → 时间
    cum, pts = 0, [(0, words[0]["start"] if words else 0)]
    wtotal = sum(len(clean(w["text"])) for w in words) or 1
    for w in words:
        cum += len(clean(w["text"]))
        pts.append((cum / wtotal, w["end"]))

    def time_at(frac):
        for (f0, t0), (f1, t1) in zip(pts, pts[1:]):
            if f0 <= frac <= f1:
                return t0 + (t1 - t0) * ((frac - f0) / (f1 - f0) if f1 > f0 else 0)
        return pts[-1][1]

    track, acc = [], 0
    for c in chunks:
        a = time_at(acc / total)
        acc += len(clean(c))
        b = time_at(acc / total)
        text = re.sub(r"[，。！：；、]+$", "", c).replace("——", "")
        track.append([a, b, text])
    for i in range(len(track) - 1):
        track[i][1] = track[i + 1][0]
    if track:
        track[-1][1] = min(dur + 0.3, track[-1][1] + 0.4)
    return track


# ---------------- 渲染 ----------------
def paste_center(canvas, img, cx, cy, alpha=1.0, scale=1.0):
    if scale != 1.0:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.BICUBIC)
    if alpha < 1.0:
        img = img.copy()
        a = img.getchannel("A").point(lambda v: int(v * alpha))
        img.putalpha(a)
    canvas.alpha_composite(img, (int(cx - img.width / 2), int(cy - img.height / 2)))


def anim_in_out(t, start, end, fade=0.22):
    """出现/消失的进度：返回 (alpha, scale)。"""
    if t < start or t > end:
        return 0.0, 1.0
    pin = min(1.0, (t - start) / fade)
    pout = min(1.0, (end - t) / fade)
    a = min(pin, pout)
    return a, 0.85 + 0.15 * ease_out_back(pin)


class Segment:
    def __init__(self, seg: dict, timing: dict):
        self.seg = seg
        self.items = []  # 每个镜头：dict(clip, t0, dur, narr_at, shot)
        t = 0.0
        for shot in seg["shots"]:
            clip = Clip(shot["id"], shot["kind"])
            tm = timing[shot["id"]]
            lead = shot.get("lead", 0.15)
            need = lead + tm["dur"] + shot.get("pad", 0.25)
            # 画面比配音长太多时适当加速：功能速览最多 2 倍，其余最多 1.35 倍（几乎看不出来）
            max_speed = shot.get("maxSpeed", 2.0 if seg["id"] == "6" else 1.35)
            if clip.kind == "rec" and clip.length > need + 0.05:
                clip = Clip(shot["id"], shot["kind"], min(max_speed, clip.length / need))
            dur = max(clip.length, need)
            self.items.append(dict(clip=clip, t0=t, dur=dur, narr_at=t + lead, shot=shot, tts=tm))
            t += dur
        self.length = t

    def item_at(self, t):
        for it in self.items:
            if t < it["t0"] + it["dur"]:
                return it
        return self.items[-1]


def render_base(clip: Clip, lt: float, frame_file: str, cam):
    src = load_frame(str(clip.dir / frame_file))
    if clip.kind == "html":
        img = src if src.size == (W, H) else src.resize((W, H), Image.BICUBIC)
        return img.convert("RGBA")
    sx = src.width / VIEW_W
    box = (cam[0] * sx, cam[1] * sx, (cam[0] + cam[2]) * sx, (cam[1] + cam[3]) * sx)
    x, y, w, h = WIN
    inner = src.resize((w, h), Image.BICUBIC, box=box)
    base, mask, border = window_layers()
    canvas = base.copy()
    canvas.paste(inner, (x, y), mask)
    canvas.alpha_composite(border)
    return canvas


WIPE = 0.3  # 段落转场：前段末尾色带盖住，后段开头色带揭开


def wipe_overlay(canvas, p, entering):
    """色带从左往右扫过。entering=True：盖住画面；False：揭开画面。"""
    p = ease(p)
    skew = 260
    if entering:
        right = -skew + (W + skew * 2) * p
        left = -skew * 2
    else:
        left = -skew + (W + skew * 2) * p
        right = W + skew * 2
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    d.polygon([(left, 0), (right + skew, 0), (right, H), (left - skew, H)], fill=(196, 188, 245, 255))
    d.polygon([(right - 30, 0), (right + skew, 0), (right, H), (right - 30 - skew, H)], fill=PINK + (255,))
    canvas.alpha_composite(over)


def render_segment(seg: dict, timing: dict, out: Path, first: bool, last: bool):
    S = Segment(seg, timing)
    n = int(math.ceil(S.length * FPS))
    ow, oh = int(W * SCALE), int(H * SCALE)
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}", "-r", str(FPS),
         "-i", "-", "-c:v", "libx264", "-preset", "veryfast" if PREVIEW else "medium", "-crf", "23" if PREVIEW else "14",
         "-pix_fmt", "yuv420p", str(out)],
        stdin=subprocess.PIPE,
    )
    subs = []
    flowers = []
    for it in S.items:
        shot, tm = it["shot"], it["tts"]
        for a, b, text in subtitle_track(shot["narr"], tm["words"], tm["dur"]):
            subs.append((it["narr_at"] + a, it["narr_at"] + b, text))
        for fl in shot.get("flower", []):
            start = it["narr_at"] + fl["at"]
            end = it["t0"] + it["dur"] - 0.15
            flowers.append((start, end, fl["text"], fl.get("style", "")))
    feats = [it for it in S.items if it["shot"].get("feature")]

    cache_key, cache_img = None, None
    for i in range(n):
        t = i / FPS
        it = S.item_at(t)
        clip, lt = it["clip"], t - it["t0"]
        lt = min(lt, clip.length)
        cam = clip.camera(lt)
        fr = clip.frame_at(lt)
        key = (clip.id, fr, tuple(round(c, 2) for c in cam))
        if key != cache_key:
            cache_img = render_base(clip, lt, fr, cam)
            cache_key = key
        canvas = cache_img.copy()

        # 功能速览角标
        for k, f in enumerate(feats):
            if f["t0"] <= t < f["t0"] + f["dur"]:
                a, s = anim_in_out(t, f["t0"], f["t0"] + f["dur"] + 1, 0.25)
                img = feature_img(k + 1, len(feats), f["shot"]["feature"])
                paste_center(canvas, img, WIN[0] + 24 + img.width / 2, WIN[1] + WIN[3] - 24 - img.height / 2, a, s)
        # 花字
        for start, end, text, style in flowers:
            a, s = anim_in_out(t, start, end)
            if a <= 0:
                continue
            img = flower_img(text, style)
            if style == "big":
                paste_center(canvas, img, W / 2, H / 2 - 40, a, s)
            elif style == "note":
                paste_center(canvas, img, WIN[0] + WIN[2] - img.width / 2 - 10, WIN[1] + 50, a, 1.0)
            else:
                paste_center(canvas, img, W / 2, 128, a, s)
        # 字幕
        for start, end, text in subs:
            if start <= t < end:
                a = min(1.0, (t - start) / 0.08, (end - t) / 0.08)
                paste_center(canvas, subtitle_img(text), W / 2, H - 74, a)
                break
        # 段落转场
        if not first and t < WIPE:
            wipe_overlay(canvas, t / WIPE, entering=False)
        if not last and t > S.length - WIPE:
            wipe_overlay(canvas, (t - (S.length - WIPE)) / WIPE, entering=True)

        frame = canvas.convert("RGB")
        if SCALE != 1.0:
            frame = frame.resize((ow, oh), Image.BILINEAR)
        ff.stdin.write(frame.tobytes())
        if i % (FPS * 5) == 0:
            print(f"  {seg['id']}: {t:5.1f}/{S.length:.1f}s", flush=True)
    ff.stdin.close()
    ff.wait()
    return S


def main():
    cfg = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
    timing = json.loads((VIDEO / "素材" / "tts" / "timing.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    segs = cfg["segments"]
    tl_path = OUT / "timeline.json"
    timeline = json.loads(tl_path.read_text(encoding="utf-8")) if tl_path.exists() else {}
    for k, seg in enumerate(segs):
        if only and seg["id"] not in only:
            continue
        missing = [s["id"] for s in seg["shots"] if not (REC / s["id"] / "meta.json").exists()]
        if missing:
            print(f"跳过段落 {seg['id']}：缺少录制 {missing}")
            continue
        print(f"段落 {seg['id']} {seg['title']}")
        S = render_segment(seg, timing, OUT / f"seg-{seg['id']}.mp4", k == 0, k == len(segs) - 1)
        timeline[seg["id"]] = {
            "length": S.length,
            "shots": [
                {
                    "id": it["shot"]["id"],
                    "t0": it["t0"],
                    "dur": it["dur"],
                    "narr_at": it["narr_at"],
                    "clicks": [it["t0"] + c for c in it["clip"].clicks if c <= it["dur"]],
                    "keys": [it["t0"] + c for c in it["clip"].keys if c <= it["dur"]],
                    "flowers": [it["narr_at"] + f["at"] for f in it["shot"].get("flower", [])],
                    "subs": subtitle_track(it["shot"]["narr"], it["tts"]["words"], it["tts"]["dur"]),
                }
                for it in S.items
            ],
        }
        tl_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
