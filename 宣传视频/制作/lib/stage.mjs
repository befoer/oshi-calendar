// 录制舞台：打开录制专用浏览器、重置演示数据、慢动作时间控制、假光标与操作。
//
// 慢动作：页面里的 CSS 动画（CDP Animation.setPlaybackRate）和 JS 时间（Playwright 假时钟）
// 都按 1/SLOW 的速度流动，脚本操作也放慢 SLOW 倍；合成时再加速 SLOW 倍。
// 这台机器按 2400×1350 实时只能抓到约 8 帧/秒，慢 7 倍录制后成片约 56 帧/秒。
import { chromium } from "@playwright/test";
import { PROFILE_DIR, APP_URL, DEMO_TIME } from "../config.mjs";
import { Screencast } from "./screencast.mjs";

export const SLOW = 7;
export const VIEW = { width: 1600, height: 900 };
export const DPR = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 只保留 AI 接口配置（含你填写的密钥）和已生成的寿星留言，其余本机数据每次清空
const KEEP_KEYS = ["huiqi-ai-config", "huiqi-image-config", "huiqi-birthday-pool"];

const cursorScript = () => {
  const install = () => {
    if (document.getElementById("__demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__demo-cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);will-change:transform;filter:drop-shadow(0 2px 3px rgba(30,20,80,.35))}
      #__demo-cursor svg{width:30px;height:30px;display:block;transition:transform .12s}
      #__demo-cursor.down svg{transform:scale(.82)}
      .__demo-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
        border:3px solid #F472B6;background:rgba(244,114,182,.18);z-index:2147483646;pointer-events:none;
        animation:__demo-ripple .6s ease-out forwards}
      @keyframes __demo-ripple{from{transform:scale(.4);opacity:1}to{transform:scale(3.6);opacity:0}}
      *{scroll-behavior:auto!important}
      ::-webkit-scrollbar{width:0!important;height:0!important}`;
    document.documentElement.appendChild(style);
    const el = document.createElement("div");
    el.id = "__demo-cursor";
    el.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.7 22 L14.6 20.7 L11.6 14.3 L17.8 14.3 Z" fill="#fff" stroke="#3f3a9e" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(el);
    const state = { x: -100, y: -100 };
    // 光标动画用 rAF + performance.now，跟随假时钟一起放慢
    window.__demoCursor = {
      set(x, y) {
        state.x = x;
        state.y = y;
        el.style.transform = `translate(${x - 4}px,${y - 2}px)`;
      },
      move(x, y, dur) {
        const sx = state.x < -50 ? x : state.x;
        const sy = state.y < -50 ? y : state.y;
        // 轻微弧线：控制点向一侧偏移
        const mx = (sx + x) / 2 + (y - sy) * 0.12;
        const my = (sy + y) / 2 - (x - sx) * 0.12;
        const start = performance.now();
        return new Promise((resolve) => {
          const step = () => {
            const p = Math.min(1, (performance.now() - start) / dur);
            const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            const u = 1 - e;
            this.set(u * u * sx + 2 * u * e * mx + e * e * x, u * u * sy + 2 * u * e * my + e * e * y);
            if (p < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      },
      press(down) {
        el.classList.toggle("down", down);
        if (down) {
          const r = document.createElement("div");
          r.className = "__demo-ripple";
          r.style.left = state.x + "px";
          r.style.top = state.y + "px";
          document.documentElement.appendChild(r);
          setTimeout(() => r.remove(), 700);
        }
      },
      hide() {
        el.style.display = "none";
      },
      show() {
        el.style.display = "";
      },
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

export class Stage {
  static async open() {
    const stage = new Stage();
    stage.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "msedge",
      headless: true,
      // 无头模式的屏幕广播默认按 CSS 像素出帧，强制设备像素比才能拿到 2400×1350 的清晰画面
      args: [`--force-device-scale-factor=${DPR}`],
      viewport: VIEW,
      deviceScaleFactor: DPR,
      serviceWorkers: "block",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      permissions: ["clipboard-read", "clipboard-write"],
      acceptDownloads: true,
    });
    stage.page = stage.context.pages()[0] ?? (await stage.context.newPage());
    stage.page.setDefaultTimeout(60000);
    await stage.context.addInitScript(cursorScript);
    stage.cdp = await stage.context.newCDPSession(stage.page);
    await stage.cdp.send("Animation.enable");
    return stage;
  }

  /** 清空演示数据（保留 AI 配置），装好假时钟，打开应用并等示例角色和头像就绪。 */
  async reset({ persona = { name: "画师", about: "" }, extraLocal = {} } = {}) {
    const page = this.page;
    await page.route("**/__demo-reset", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>reset</title>" }),
    );
    await page.goto(new URL("__demo-reset", APP_URL).href);
    await page.evaluate(
      async ({ keep, persona, extraLocal }) => {
        const dbs = (await indexedDB.databases?.()) ?? [{ name: "huiqi-calendar" }];
        for (const db of dbs) {
          await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          });
        }
        for (const key of Object.keys(localStorage)) if (!keep.includes(key)) localStorage.removeItem(key);
        sessionStorage.clear();
        localStorage.setItem("huiqi-chat-persona", JSON.stringify(persona));
        for (const [k, v] of Object.entries(extraLocal)) localStorage.setItem(k, v);
      },
      { keep: KEEP_KEYS, persona, extraLocal },
    );
    await page.clock.install({ time: new Date(DEMO_TIME) });
    await page.goto(APP_URL);
    await page.getByRole("navigation", { name: "主导航" }).waitFor();
    await this.waitImages();
  }

  /** 等页面上所有头像图片加载完成（示例角色的头像首次需要联网下载）。 */
  async waitImages(timeout = 90000) {
    await this.page
      .waitForFunction(
        () => {
          const imgs = [...document.images].filter((i) => i.getBoundingClientRect().width > 0);
          return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
        },
        null,
        { timeout, polling: 500 },
      )
      .catch(() => console.warn("  ! 有图片未加载完"));
  }

  /** 直接改 IndexedDB 里的角色（准备演示状态用），改完刷新页面。 */
  async editCharacters(fn) {
    await this.page.evaluate(async (src) => {
      const edit = new Function("c", `return (${src})(c)`);
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("huiqi-calendar");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve) => {
        const tx = db.transaction("characters", "readwrite");
        const req = tx.objectStore("characters").openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return;
          const next = edit(cur.value);
          if (next) cur.update(next);
          cur.continue();
        };
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, fn.toString());
    await this.page.reload();
    await this.page.getByRole("navigation", { name: "主导航" }).waitFor();
    await this.waitImages();
  }

  // ---------- 慢动作 ----------
  async warpOn() {
    if (this.warping) return;
    const page = this.page;
    await this.cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 1500)); // 留足余量：慢机器上调用本身要花时间
    this.warping = true;
    this.warpLoop = (async () => {
      let last = Date.now();
      while (this.warping) {
        const t = Date.now();
        const dt = Math.min(80, t - last);
        last = t;
        if (dt > 0) await page.clock.runFor(dt / SLOW).catch(() => {});
        await sleep(8);
      }
    })();
  }
  async warpOff() {
    if (!this.warping) return;
    this.warping = false;
    await this.warpLoop;
    await this.cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await this.page.clock.resume();
  }

  // ---------- 录制 ----------
  async startRec(dir) {
    this.rec = new Screencast(this.page, dir, { width: VIEW.width * DPR, height: VIEW.height * DPR, quality: 92 });
    await this.rec.start();
    await this.wait(0.3);
  }
  mark(name) {
    this.rec?.mark(name);
  }
  async stopRec() {
    await this.wait(0.3);
    const meta = await this.rec.stop();
    this.rec = null;
    return meta;
  }

  /** 等待成片时间 s 秒（实际等待 s × SLOW）。 */
  async wait(s) {
    await sleep(s * 1000 * (this.warping ? SLOW : 1));
  }

  // ---------- 光标与操作（时长均为成片时间，秒） ----------
  async point(target) {
    if (typeof target.x === "number") return target;
    const loc = target;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox();
    if (!box) throw new Error("元素不可见：" + loc);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  async cursorAt(x, y) {
    await this.page.evaluate(([x, y]) => window.__demoCursor?.set(x, y), [x, y]);
    await this.page.mouse.move(x, y);
  }
  async move(target, dur = 0.6) {
    const { x, y } = await this.point(target);
    // 光标动画在页面里按假时钟跑；这里按实际时长等待它跑完
    const done = this.page.evaluate(([x, y, d]) => window.__demoCursor?.move(x, y, d), [x, y, dur * 1000]);
    await done;
    await this.page.mouse.move(x, y);
    return { x, y };
  }
  async click(target, { dur = 0.6, after = 0.35, mark } = {}) {
    await this.move(target, dur);
    await this.wait(0.08);
    if (mark) this.mark(mark);
    else this.mark("click");
    await this.page.evaluate(() => window.__demoCursor?.press(true));
    await this.page.mouse.down();
    await this.wait(0.08);
    await this.page.mouse.up();
    await this.page.evaluate(() => window.__demoCursor?.press(false));
    await this.wait(after);
  }
  async type(text, { cps = 9 } = {}) {
    for (const ch of text) {
      await this.page.keyboard.insertText(ch);
      this.mark("key");
      await this.wait(1 / cps);
    }
  }
  async press(key, after = 0.3) {
    this.mark("key");
    await this.page.keyboard.press(key);
    await this.wait(after);
  }
  /** 平滑滚动某个滚动容器（默认页面主滚动区）到 y。 */
  async scrollTo(y, dur = 1.0, selector = null) {
    await this.page.evaluate(
      ([y, d, sel]) =>
        new Promise((resolve) => {
          const pick = () => {
            if (sel) return document.querySelector(sel);
            const cands = [document.scrollingElement, ...document.querySelectorAll("main, .main, [class*=content]")];
            return cands.find((el) => el && el.scrollHeight > el.clientHeight + 4) || document.scrollingElement;
          };
          const el = pick();
          const sy = el.scrollTop;
          const start = performance.now();
          const step = () => {
            const p = Math.min(1, (performance.now() - start) / d);
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            el.scrollTop = sy + (y - sy) * e;
            if (p < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        }),
      [y, dur * 1000, selector],
    );
  }
  async drag(from, to, dur = 1.0) {
    const a = await this.move(from, 0.5);
    this.mark("click");
    await this.page.evaluate(() => window.__demoCursor?.press(true));
    await this.page.mouse.down();
    await this.wait(0.15);
    const b = await this.point(to);
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const x = a.x + (b.x - a.x) * e;
      const y = a.y + (b.y - a.y) * e;
      await this.page.evaluate(([x, y]) => window.__demoCursor?.set(x, y), [x, y]);
      await this.page.mouse.move(x, y);
      await this.wait(dur / steps);
    }
    await this.wait(0.1);
    await this.page.mouse.up();
    await this.page.evaluate(() => window.__demoCursor?.press(false));
    await this.wait(0.3);
  }

  /** HTML5 原生拖放：光标做拖动动画，松手时由 Playwright 的 dragTo 完成实际拖放。 */
  async dragNative(from, to, dur = 1.0) {
    await this.move(from, 0.5);
    this.mark("click");
    await this.page.evaluate(() => window.__demoCursor?.press(true));
    await this.wait(0.12);
    const b = await this.point(to);
    await this.page.evaluate(([x, y, d]) => window.__demoCursor?.move(x, y, d), [b.x, b.y, dur * 1000]);
    await from.dragTo(to);
    await this.page.evaluate(() => window.__demoCursor?.press(false));
    await this.wait(0.3);
  }

  async close() {
    await this.warpOff().catch(() => {});
    await this.context.close();
  }
}
