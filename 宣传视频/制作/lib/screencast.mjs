// 用 CDP 屏幕广播逐帧抓取页面画面（高质量 JPEG + 时间戳），比 Playwright 自带录像清晰。
// 帧只在画面变化时产生；合成时按时间戳补齐成恒定帧率。
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export class Screencast {
  constructor(page, dir, { width, height, quality = 92 } = {}) {
    this.page = page;
    this.dir = dir;
    this.size = { width, height };
    this.quality = quality;
    this.frames = [];
    this.marks = [];
    this.pending = [];
  }
  async start() {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", (frame) => {
      const index = this.frames.length;
      const file = `f${String(index).padStart(6, "0")}.jpg`;
      this.frames.push({ file, t: frame.metadata.timestamp });
      this.pending.push(writeFile(join(this.dir, file), Buffer.from(frame.data, "base64")));
      this.cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: this.quality,
      maxWidth: this.size.width,
      maxHeight: this.size.height,
      everyNthFrame: 1,
    });
    this.t0 = Date.now() / 1000;
  }
  /** 记录一个时间点（秒，墙钟），合成时用于切分镜头和对齐音效。 */
  mark(name) {
    this.marks.push({ name, t: Date.now() / 1000 });
  }
  async stop() {
    // 停止前强制多出一帧，保证最后的静止画面有时长
    this.mark("__end");
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(this.pending);
    const meta = { frames: this.frames, marks: this.marks, t0: this.t0 };
    await writeFile(join(this.dir, "meta.json"), JSON.stringify(meta));
    return meta;
  }
}
