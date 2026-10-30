"""按 shots.json 逐句生成配音（edge-tts），并记录每个字词的时间，供字幕和剪辑对齐。

输出：素材/tts/<镜头>.mp3 和 素材/tts/timing.json
用法：python 宣传视频/制作/tts.py [--force]
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "素材" / "tts"


def tts_text(text: str, replace: dict) -> str:
    for a, b in replace.items():
        text = text.replace(a, b)
    return text


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return float(out.strip())


async def one(shot: dict, voice: str, rate: str, replace: dict, force: bool) -> dict:
    mp3 = OUT / f"{shot['id']}.mp3"
    words_file = OUT / f"{shot['id']}.words.json"
    text = tts_text(shot["narr"], replace)
    if force or not mp3.exists() or not words_file.exists():
        com = edge_tts.Communicate(text, voice, rate=shot.get("rate", rate), boundary="WordBoundary")
        words = []
        with open(mp3, "wb") as f:
            async for chunk in com.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = chunk["offset"] / 1e7
                    words.append({"text": chunk["text"], "start": start, "end": start + chunk["duration"] / 1e7})
        words_file.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    words = json.loads(words_file.read_text(encoding="utf-8"))
    return {"dur": duration(mp3), "words": words, "tts": text}


async def main(force: bool):
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
    timing = {}
    for seg in cfg["segments"]:
        for shot in seg["shots"]:
            timing[shot["id"]] = await one(shot, cfg["voice"], cfg["rate"], cfg["ttsReplace"], force)
            print(shot["id"], f"{timing[shot['id']]['dur']:.2f}s")
    (OUT / "timing.json").write_text(json.dumps(timing, ensure_ascii=False, indent=1), encoding="utf-8")
    print("total", round(sum(t["dur"] for t in timing.values()), 1))


asyncio.run(main("--force" in sys.argv))
