"""合成声音并输出成片：配音 + 合成 BGM（旁白时自动压低）+ 合成音效，拼接各段画面，输出 mp4 和 srt。

前提：compose.py 已渲染好 素材/render/seg-*.mp4 和 timeline.json。
用法：python 宣传视频/制作/build.py [--bgm 曲子.mp3] [--out 文件名.mp4] [--bgm-db -9]
  --bgm-db：BGM 比旁白低多少分贝（旁白停顿处；旁白进行时再自动压低约 2 dB）
输出：成片/推日-宣传片.mp4、成片/字幕.srt
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
MAT = VIDEO / "素材"
RENDER = MAT / "render"
FINAL = VIDEO / "成片"
SR = 48000
rng = np.random.default_rng(7)


# ---------------- 基础 ----------------
def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def place(buf: np.ndarray, clip: np.ndarray, t: float, gain: float = 1.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    if i < 0:
        clip, i = clip[-i:], 0
    n = min(len(clip), len(buf) - i)
    buf[i:i + n] += clip[:n] * gain


def stereo(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    return np.stack([mono * l, mono * r], axis=1).astype(np.float32)


def env(n, attack, release_tau):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / release_tau)


def lowpass_fast(x, cutoff):
    """一阶低通（向量化近似：频域乘法）。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / cutoff) ** 2), len(x))


# ---------------- 音效 ----------------
def sfx_click():
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1900 * t) * env(n, 0.0005, 0.006) * 0.5
    x += rng.normal(0, 1, n) * env(n, 0.0003, 0.003) * 0.25
    return stereo(x, 0.1)


def sfx_key():
    n = int(0.03 * SR)
    x = lowpass_fast(rng.normal(0, 1, n), 3500) * env(n, 0.0003, 0.004)
    return stereo(x * 0.5, -0.1)


def sfx_ding():
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    x = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(1568, 1), (2352, 0.35), (3136, 0.18)])
    return stereo(x * env(n, 0.002, 0.22) * 0.35)


def sfx_whoosh():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    x = lowpass_fast(noise, 1800) * np.sin(np.pi * t / t[-1]) ** 2
    return np.stack([x * (1 - t / t[-1]), x * (t / t[-1])], axis=1).astype(np.float32) * 0.35


def sfx_scratch():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 900 * np.exp(-t * 5) + 120
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sign(np.sin(ph)) * 0.3 + rng.normal(0, 0.4, n)) * env(n, 0.005, 0.15)
    return stereo(lowpass_fast(x, 3000) * 0.55)


def sfx_thump():
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 90 * np.exp(-t * 6) + 45
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.18)
    return stereo(x * 0.9)


# ---------------- BGM ----------------
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name: str) -> float:
    n, o = name[:-1], int(name[-1])
    return 440 * 2 ** ((NOTE[n[0]] + (1 if "#" in n else 0) + 12 * (o + 1) - 69) / 12)


# 王道进行 IV–V–iii–vi（F – G – Em – Am），96 BPM，每和弦一小节
CHORDS = [
    ("F2", ["F3", "A3", "C4", "E4"]),
    ("G2", ["G3", "B3", "D4", "F#4"]),
    ("E2", ["E3", "G3", "B3", "D4"]),
    ("A2", ["A3", "C4", "E4", "G4"]),
]
BPM = 96
BEAT = 60 / BPM


def epiano(freq, dur, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * 2 * t) * 1.2 * np.exp(-t * 3)
    x = np.sin(2 * np.pi * freq * t + mod) * env(n, 0.003, 0.55)
    x += 0.25 * np.sin(2 * np.pi * freq * 4 * t) * env(n, 0.001, 0.05)
    return x * vel


def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        for d in (-0.12, 0.12):
            x += np.sin(2 * np.pi * f * (1 + d / 100) * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)
    fade = np.minimum(1, np.minimum(t / 0.4, (dur - t) / 0.4))
    return x * fade / len(freqs) / 2


def make_bgm(total: float, music_start: float, dip_at: float, end_at: float) -> np.ndarray:
    n = int(total * SR) + SR
    L = np.zeros(n)
    R = np.zeros(n)
    bar = BEAT * 4
    t0 = music_start
    k = 0
    while t0 < end_at:
        root, chord = CHORDS[k % 4]
        freqs = [midi(c) for c in chord]
        i = int(t0 * SR)
        p = pad(freqs, bar + 0.3) * 0.16
        seg = slice(i, min(n, i + len(p)))
        L[seg] += p[: seg.stop - seg.start]
        R[seg] += p[: seg.stop - seg.start]
        # 低音
        b = epiano(midi(root), bar * 0.95, 0.5)
        L[i:i + len(b)][: n - i] += b[: n - i] * 0.6
        R[i:i + len(b)][: n - i] += b[: n - i] * 0.6
        # 电钢琴分解和弦（八分音符），第一圈只弹一半，慢慢进入
        pattern = [0, 2, 1, 3, 2, 1, 3, 2]
        for s, idx in enumerate(pattern):
            if k == 0 and s % 2:
                continue
            ts = t0 + s * BEAT / 2
            note = epiano(freqs[idx] * 2, BEAT * 1.5, 0.28 if s % 2 else 0.36)
            j = int(ts * SR)
            pan = -0.35 if s % 2 else 0.35
            if j < n:
                m = min(len(note), n - j)
                L[j:j + m] += note[:m] * np.sqrt(0.5 * (1 - pan))
                R[j:j + m] += note[:m] * np.sqrt(0.5 * (1 + pan))
        # 轻打击：第 2、4 拍沙锤，第 1、3 拍软底鼓（第二圈起）
        if k >= 1:
            for beat in range(4):
                tb = t0 + beat * BEAT
                j = int(tb * SR)
                if beat % 2 == 0:
                    kick = sfx_thump()[:, 0] * 0.35
                    m = min(len(kick), n - j)
                    L[j:j + m] += kick[:m]
                    R[j:j + m] += kick[:m]
                sh = lowpass_fast(rng.normal(0, 1, int(0.06 * SR)), 9000) * env(int(0.06 * SR), 0.004, 0.02) * 0.08
                for off in (BEAT / 2,):
                    jj = int((tb + off) * SR)
                    m = min(len(sh), n - jj)
                    if m > 0:
                        L[jj:jj + m] += sh[:m] * 0.8
                        R[jj:jj + m] += sh[:m]
        t0 += bar
        k += 1
    # 结尾：主和弦长音
    i = int(end_at * SR)
    final = pad([midi("F3"), midi("A3"), midi("C4"), midi("E4")], 3.5) * 0.2
    m = min(len(final), n - i)
    L[i:i + m] += final[:m]
    R[i:i + m] += final[:m]
    bgm = np.stack([L, R], axis=1)
    # 「还有一件事」前后静音一拍
    t = np.arange(n) / SR
    gate = np.ones(n)
    a, b = dip_at - 0.25, dip_at + 1.3
    gate[(t > a) & (t < b)] = 0.0
    ramp = int(0.2 * SR)
    gate = np.convolve(gate, np.ones(ramp) / ramp, mode="same")
    # 渐入渐出
    fade_in = np.clip((t - music_start) / 1.2, 0, 1)
    fade_out = np.clip((total - t) / 2.5, 0, 1)
    return (bgm * (gate * fade_in * fade_out)[:, None]).astype(np.float32)


# ---------------- 主流程 ----------------
def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def rms(x: np.ndarray, gate: float = 0.01) -> float:
    """有声部分的均方根（忽略静音段）。"""
    level = np.abs(x).max(axis=1)
    active = x[level > gate]
    return float(np.sqrt((active**2).mean())) if len(active) else 0.0


def main():
    cfg = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
    timeline = json.loads((RENDER / "timeline.json").read_text(encoding="utf-8"))
    order = [s["id"] for s in cfg["segments"]]
    missing = [s for s in order if s not in timeline or not (RENDER / f"seg-{s}.mp4").exists()]
    if missing:
        sys.exit(f"缺少段落渲染：{missing}")
    offsets, t = {}, 0.0
    for sid in order:
        offsets[sid] = t
        t += timeline[sid]["length"]
    total = t
    print(f"总时长 {total:.1f}s")

    voice = np.zeros((int(total * SR) + SR, 2), np.float32)
    fx = np.zeros_like(voice)
    srt = []
    click, key, ding, whoosh = sfx_click(), sfx_key(), sfx_ding(), sfx_whoosh()
    dip_at = None
    for sid in order:
        off = offsets[sid]
        if sid != order[0]:
            place(fx, whoosh, off - 0.3, 0.6)
        for sh in timeline[sid]["shots"]:
            place(voice, decode(MAT / "tts" / f"{sh['id']}.mp3"), off + sh["narr_at"])
            for c in sh["clicks"]:
                place(fx, click, off + c, 0.55)
            for k in sh["keys"]:
                place(fx, key, off + k, 0.3)
            for f in sh["flowers"]:
                if sh["id"] == "0-2":
                    place(fx, sfx_scratch(), off + f, 0.8)
                elif sh["id"] == "0-3":
                    place(fx, sfx_thump(), off + f, 0.8)
                else:
                    place(fx, ding, off + f, 0.35)
            if sh["id"] == "7-1":
                dip_at = off + sh["t0"]
            for a, b, text in sh["subs"]:
                srt.append((off + sh["narr_at"] + a, off + sh["narr_at"] + b, text))

    music_start = 0.0  # 从视频一开始就放
    bgm_file = Path(arg("--bgm")) if arg("--bgm") else None
    if not bgm_file and (MAT / "bgm.mp3").exists():
        bgm_file = MAT / "bgm.mp3"
    if bgm_file:
        print(f"使用 BGM：{bgm_file}")
        src = decode(bgm_file)
        bgm = np.zeros_like(voice)
        reps = int(np.ceil((len(bgm) - music_start * SR) / len(src))) + 1
        place(bgm, np.tile(src, (reps, 1)), music_start)
        tt = np.arange(len(bgm)) / SR
        bgm *= np.clip((total - tt) / 2.5, 0, 1)[:, None]
    else:
        bgm = make_bgm(total, music_start, dip_at or total, total - 3.6)[: len(voice)]
        if len(bgm) < len(voice):
            bgm = np.pad(bgm, ((0, len(voice) - len(bgm)), (0, 0)))

    # BGM 音量按旁白定：停顿处比旁白低 bgm_db 分贝
    bgm_db = float(arg("--bgm-db", -9))
    v, b = rms(voice), rms(bgm)
    if v and b:
        bgm *= v * 10 ** (bgm_db / 20) / b
    # 旁白时再压低 BGM（侧链：配音包络 → 增益）。压低幅度 22%（约 -2 dB），比最初的 55% 减弱 60%
    level = np.abs(voice).max(axis=1)
    win = int(0.25 * SR)
    smooth = np.convolve(level, np.ones(win) / win, mode="same")
    duck = 1 - 0.22 * np.clip(smooth / 0.04, 0, 1)
    mix = voice * 1.0 + bgm * duck[:, None] + fx
    peak = np.abs(mix).max()
    if peak > 0.98:
        mix *= 0.98 / peak
    MAT.mkdir(exist_ok=True)
    wav = RENDER / "mix.f32"
    mix.astype(np.float32).tofile(wav)

    # 画面拼接
    lst = RENDER / "concat.txt"
    lst.write_text("".join(f"file 'seg-{s}.mp4'\n" for s in order), encoding="utf-8")
    FINAL.mkdir(exist_ok=True)
    out = FINAL / arg("--out", "推日-宣传片.mp4")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", str(wav),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy",
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "320k", "-ar", str(SR),
         "-movflags", "+faststart", "-shortest", str(out)],
        check=True,
    )
    # 字幕
    def ts(x):
        h, m = int(x // 3600), int(x % 3600 // 60)
        return f"{h:02d}:{m:02d}:{int(x % 60):02d},{int(round(x % 1 * 1000)) % 1000:03d}"

    (FINAL / "字幕.srt").write_text(
        "".join(f"{i + 1}\n{ts(a)} --> {ts(b)}\n{text}\n\n" for i, (a, b, text) in enumerate(srt)), encoding="utf-8"
    )
    # 章节时间（给简介用）
    chapters = "\n".join(
        f"{int(offsets[s['id']] // 60):02d}:{int(offsets[s['id']] % 60):02d} {s['title']}" for s in cfg["segments"]
    )
    (FINAL / "章节.txt").write_text(chapters + "\n", encoding="utf-8")
    print(out)
    print(chapters)


if __name__ == "__main__":
    main()
