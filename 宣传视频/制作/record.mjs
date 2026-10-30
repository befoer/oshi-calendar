// 驱动应用逐个录制镜头。用法：node 宣传视频/制作/record.mjs [分组名…]（不填则录全部分组）
// 每个镜头输出到 素材/rec/<镜头>/：逐帧 JPEG + meta.json（时间点、推镜、剪掉的等待）。
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Stage, SLOW } from "./lib/stage.mjs";
import { REC_DIR, VIDEO_DIR } from "./config.mjs";

const shotsCfg = JSON.parse(await readFile(join(VIDEO_DIR, "制作/shots.json"), "utf8"));
const timing = JSON.parse(await readFile(join(VIDEO_DIR, "素材/tts/timing.json"), "utf8"));
const shotInfo = Object.fromEntries(shotsCfg.segments.flatMap((s) => s.shots).map((s) => [s.id, s]));
/** 镜头的目标时长（成片秒）：配音 + 前后留白 */
const target = (id) => (shotInfo[id].lead ?? 0.15) + timing[id].dur + (shotInfo[id].pad ?? 0.25);

// 导航按钮的无障碍名称是全称（如「创作工作台」「创作任务」），按结尾匹配
const nav = (s, name) =>
  s.page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: new RegExp(name + "$") }).first();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 录一个镜头：开录 → 执行动作 → 补足到目标时长 → 停录 */
async function shot(s, id, fn) {
  // ONLY=4-3,5-2 只重录这几个镜头（其他镜头的动作也跳过）
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(id)) return;
  console.log(`● ${id}（目标 ${target(id).toFixed(1)}s）`);
  const extra = { zooms: [], cuts: [] };
  s.zoom = (rect, dur = 0.5) => {
    s.mark("zoom");
    extra.zooms.push({ t: Date.now() / 1000, rect, dur });
  };
  s.cut = async (fn) => {
    const a = Date.now() / 1000;
    await fn();
    extra.cuts.push([a, Date.now() / 1000]);
  };
  await s.warpOn();
  await s.startRec(join(REC_DIR, id));
  const start = Date.now() / 1000;
  try {
    await fn(s);
  } catch (e) {
    console.error(`  ✗ ${id}:`, e.message);
    await writeFile(join(REC_DIR, `${id}-error.txt`), String(e.stack || e)).catch(() => {});
    await s.page.screenshot({ path: join(REC_DIR, `${id}-error.png`) }).catch(() => {});
  }
  const cutLen = extra.cuts.reduce((n, [a, b]) => n + (b - a), 0);
  const used = (Date.now() / 1000 - start - cutLen) / SLOW;
  if (used < target(id)) await s.wait(target(id) - used);
  const meta = await s.stopRec();
  await s.warpOff();
  await writeFile(
    join(REC_DIR, id, "meta.json"),
    JSON.stringify({ ...meta, start, slow: SLOW, ...extra }),
  );
  const len = (meta.marks.at(-1).t - start - cutLen) / SLOW;
  console.log(`  成片长度 ${len.toFixed(1)}s，${meta.frames.length} 帧`);
}

// 推镜区域（视口 CSS 像素，x, y, w, h；按 16:9 显示）
const R = {
  full: null,
  heroText: [200, 120, 900, 506],
  spotlight: [930, 100, 600, 338],
  strip: [180, 520, 1360, 765],
};

// 3-5 里 AI 批量添加的角色，录完存在这里；其他镜头的演示空间直接载入，月历、近期生日更丰富
const BATCH_FILE = join(VIDEO_DIR, "素材/batch-characters.json");
// 名单原样发给 AI（Tag 里的反斜杠是提示词转义，保留）
const BATCH_LIST = String.raw`爱蜜莉雅
八奈见杏菜
下江小春
流萤
遐蝶
铃兰 suzuran \(arknights\)
迷迭香 rosmontis \(arknights\)
洛茜 rossi (arknights)
独角兽 unicorn \(long-awaited date\) \(azur lane\)
千夏 sunna \(zenless zone zero\)
黑岩射手 black rock shooter`.split("\n");

/** 演示工作空间：示例角色 + 露露卡改用全名 + 几位标星，并等首页寿星留言就绪。 */

async function prep(s, { batch = true } = {}) {
  await s.reset();
  if (batch && existsSync(BATCH_FILE)) {
    const records = JSON.parse(await readFile(BATCH_FILE, "utf8"));
    await s.page.evaluate(async (records) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("huiqi-calendar");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve) => {
        const tx = db.transaction("characters", "readwrite");
        for (const c of records) tx.objectStore("characters").put(c);
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, records);
  }
  await s.editCharacters((c) => {
    if (c.name === "露露卡") c.name = "森亚露露卡";
    if (["露露卡", "森亚露露卡", "香风智乃", "白", "波奇酱"].includes(c.name)) c.starred = true;
    return c;
  });
  await s.page
    .waitForFunction(() => {
      const el = document.querySelector(".spotlight");
      return el && !/配置 AI 接口|正在|生成中/.test(el.textContent) && el.textContent.length > 40;
    }, null, { timeout: 150000 })
    .catch(() => console.warn("  ! 寿星留言未就绪"));
  await s.cursorAt(1500, 860);
}

/** 等条件满足（在 s.cut 里用，等待过程会从成片里剪掉）。 */
const until = (s, fn, arg, timeout = 120000) =>
  s.page.waitForFunction(fn, arg, { timeout, polling: 200 }).catch(() => console.warn("  ! 等待超时"));

const saveDownload = (s, name) =>
  s.page.once("download", (d) => d.saveAs(join(VIDEO_DIR, "素材", name)).catch(() => {}));

/** 截取片头片尾场景要用的静态素材（不带光标）。 */
async function stills(s) {
  const dir = join(VIDEO_DIR, "素材/stills");
  await s.page.evaluate(() => window.__demoCursor?.hide());
  await nav(s, "工作台").click();
  await s.scrollTo(0, 0.01);
  await sleep(1500);
  await s.page.screenshot({ path: join(dir, "home.png") });
  await s.page.locator(".spotlight img").first().screenshot({ path: join(dir, "lulu.png") });
  // 角色库（封面背景用）
  await nav(s, "角色库").click();
  await sleep(2000);
  await s.waitImages();
  await s.page.screenshot({ path: join(dir, "library.png") });
  // 整页（全部角色卡片），封面缩小上移后仍能铺满
  await s.scrollTo(2000, 0.01);
  await sleep(800);
  await s.waitImages();
  await s.scrollTo(0, 0.01);
  await sleep(500);
  await s.page.screenshot({ path: join(dir, "library-full.png"), fullPage: true });
  await nav(s, "日历").click();
  await sleep(1200);
  await s.page.getByTitle("下个月").click();
  await sleep(1500);
  await s.page.screenshot({ path: join(dir, "calendar-dec.png") });
  await s.page.evaluate(() => window.__demoCursor?.show());
}

const sessions = {
  // 段落 2：首页与日历
  async home(s) {
    await prep(s);

    await shot(s, "2-1", async () => {
      await s.wait(0.3);
      s.zoom(R.heroText, 0.8);
      await s.move(s.page.locator(".hero-narration"), 1.2);
    });
    await shot(s, "2-2", async () => {
      s.zoom(R.spotlight, 0.8);
      // 光标移到留言文字区域（按寿星卡位置算，避免逐个找文字节点）
      const sb = await s.page.locator(".spotlight").boundingBox();
      await s.move({ x: sb.x + sb.width * 0.62, y: sb.y + sb.height * 0.52 }, 1.0);
    });
    await shot(s, "2-3", async () => {
      s.zoom(R.full, 0.6);
      await s.scrollTo(440, 1.2);
      await s.move(s.page.locator(".bc-tags").first(), 0.8);
      await s.wait(0.6);
      await s.move(s.page.locator(".bc-tags").nth(1), 0.5);
      await s.move(s.page.locator(".bc-tags").nth(2), 0.5);
      await s.wait(1.2);
      await s.click(s.page.locator("label", { hasText: "仅标星" }).first(), { after: 0.8 });
    });
    // 2-4 直接从 11 月月历开始（镜头外切页面）
    await nav(s, "日历").click();
    await sleep(1500);
    await s.scrollTo(0, 0.01);
    await s.cursorAt(900, 600);
    await shot(s, "2-4", async () => {
      await s.move(s.page.locator(".day-cell.today"), 0.8);
      await s.wait(0.4);
      // 11 月往下滚一点，露出 20 日独角兽、29 日八奈见杏菜的头像格
      await s.scrollTo(330, 0.9);
      await s.move(s.page.locator(".day-cell:not(.outside)").nth(19), 0.6);
      await s.wait(0.9);
      await s.scrollTo(0, 0.6);
      await s.click(s.page.getByTitle("下个月"), { after: 1.0 });
      await s.click(s.page.locator(".day-cell:not(.outside)").nth(9), { after: 1.0 });
    });
    if (!process.env.ONLY) await stills(s);
  },

  // 只截静态素材（片头、片尾、封面用）
  async stills(s) {
    await prep(s);
    await stills(s);
  },

  // 段落 3 与 4-4：搜索添加初音未来、博丽灵梦
  async add(s) {
    await prep(s, { batch: false });
    await nav(s, "角色库").click();
    await sleep(1500);
    // 角色库按添加顺序排，新加的角色排在第一个
    await s.page.locator(".select-menu [aria-haspopup=listbox]").filter({ hasText: "生日临近" }).first().click();
    await s.page.getByRole("option", { name: "添加顺序" }).click();
    await sleep(800);
    const dialog = s.page.locator(".modal");
    const search = async (name) => {
      await s.click(s.page.getByRole("button", { name: "添加角色" }).first(), { after: 0.1 });
      s.zoom([450, 20, 700, 540], 0.5);
      await s.wait(0.4);
      await s.move(dialog.getByPlaceholder("输入角色名、Bangumi ID 或链接"), 0.5);
      await s.type(name, { cps: 6 });
      await s.wait(0.2);
      await s.press("Enter", 0.1);
      await s.cut(() => until(s, () => document.querySelectorAll(".result-row").length > 0));
      await s.wait(0.6);
    };
    const openResult = async (row) => {
      await s.click(row, { after: 0.1 });
      await s.cut(() =>
        until(s, () => {
          const t = document.querySelector(".result-item.open textarea");
          const img = document.querySelector(".result-item.open img");
          return t && t.value.trim().length > 3 && !document.querySelector(".result-item.open .spin") && img && img.complete && img.naturalWidth > 0;
        }),
      );
      await s.wait(0.3);
    };
    const confirm = () => s.click(dialog.getByRole("button", { name: "确认关联" }).last(), { after: 0.8 });

    await shot(s, "3-1", async () => {
      await search("初音未来");
    });
    await shot(s, "3-2", async () => {
      await openResult(s.page.locator(".result-row").filter({ hasText: "8月31日" }).first());
      const open = s.page.locator(".result-item.open");
      const box = await open.boundingBox();
      s.zoom([box.x - 10, box.y - 10, box.width + 20, 560], 0.7);
      await s.wait(0.6);
      await s.move(open.locator("img").first(), 0.6);
      await s.wait(0.5);
      await s.move(open.getByText(/生日原文|8月31日/).first(), 0.6);
      await s.wait(0.5);
      await s.move(open.locator("textarea").first(), 0.6);
      await s.wait(0.8);
    });
    await shot(s, "3-3", async () => {
      s.zoom(R.full, 0.5);
      await confirm();
      await s.move(s.page.locator(".character-card").first(), 0.6);
    });
    await shot(s, "3-4", async () => {
      await s.scrollTo(900, 2.6);
    });
    await s.warpOn();
    await s.scrollTo(0, 0.4);
    await s.warpOff();
    await shot(s, "3-5", async () => {
      // 一开始就推近对话区，不拍到面板顶部的模型名称
      s.zoom([329, 165, 1271, 715], 0.05);
      await s.click(s.page.getByRole("button", { name: "AI 助手" }), { after: 0.5 });
      const box = s.page.getByLabel("发送给 AI 助手");
      await s.click(box, { after: 0.2 });
      // 名单一次粘贴进去
      const text = "批量添加这些角色，自动查资料补上生日、头像和 Tag：\n" + BATCH_LIST.join("\n");
      await s.page.keyboard.insertText(text);
      s.mark("key");
      await s.wait(0.8);
      await s.press("Enter", 0.6);
      for (let round = 0; round < 6; round++) {
        await s.cut(() => until(s, (sel) => !document.querySelector(sel), "[aria-label='AI 正在运行']", 600000));
        const more = s.page.getByRole("button", { name: "继续本次操作" });
        if (!(await more.isVisible().catch(() => false))) break;
        await s.cut(async () => {
          await more.click();
          await sleep(1500);
        });
      }
      await s.wait(1.6);
      s.zoom(R.full, 0.5);
      await s.page.keyboard.press("Escape");
      await s.wait(0.6);
      await s.click(s.page.locator(".assistant-shade"), { after: 0.6 }).catch(() => {});
      await s.scrollTo(0, 0.3);
      await s.wait(1.4);
    });
    // 保存批量添加的角色（排除示例角色和本组手动添加的初音、灵梦）
    const added = await s.page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("huiqi-calendar");
        r.onsuccess = () => resolve(r.result);
      });
      const all = await new Promise((resolve) => {
        const req = db.transaction("characters").objectStore("characters").getAll();
        req.onsuccess = () => resolve(req.result);
      });
      db.close();
      return all.filter((c) => !String(c.id).startsWith("seed-") && !/初音|灵梦/.test(c.name));
    });
    if (added.length) {
      await writeFile(BATCH_FILE, JSON.stringify(added, null, 1));
      console.log(`  批量添加 ${added.length} 位：` + added.map((c) => `${c.name}${c.birthday ? ` ${c.birthday.month}/${c.birthday.day}` : ""}`).join("、"));
    }
    await shot(s, "4-4", async () => {
      await search("博丽灵梦");
      await openResult(s.page.locator(".result-row").first());
      const open = s.page.locator(".result-item.open");
      const box = await open.boundingBox();
      s.zoom([box.x - 10, box.y - 10, box.width + 20, 380], 0.6);
      await s.move(open.getByText(/生日原文/).first(), 0.6);
      await s.wait(0.7);
      s.zoom(R.full, 0.5);
      await confirm();
      const card = s.page.locator(".character-card").first();
      const cb = await card.boundingBox();
      s.zoom([cb.x - 60, cb.y - 20, cb.width + 400, cb.height + 40], 0.6);
      await s.move(card.getByText(/待确认|未知|生日/).first(), 0.6);
    });
  },

  // 段落 4：提醒设置、导出日历、节日节气
  async remind(s) {
    await prep(s);
    await shot(s, "4-1", async () => {
      await s.click(s.page.getByRole("button", { name: "编辑 森亚露露卡" }), { after: 0.8 });
      const input = s.page.locator(".modal").getByLabel("提前提醒");
      await input.scrollIntoViewIfNeeded();
      await s.wait(0.2);
      const box = await input.boundingBox();
      s.zoom([box.x - 420, box.y - 260, 800, 450], 0.6);
      await s.click(input, { after: 0.2 });
      await s.page.keyboard.press("Control+A");
      await s.type("30", { cps: 5 });
      await s.wait(0.7);
      s.zoom(R.full, 0.4);
      await s.press("Escape", 0.4);
      await s.click(nav(s, "设置"), { after: 0.6 });
      const def = s.page.getByLabel("默认提前提醒天数");
      const db = await def.boundingBox();
      s.zoom([db.x - 500, db.y - 160, 1000, 562], 0.6);
      await s.move(def, 0.6);
    });
    await shot(s, "4-2", async () => {
      s.zoom(R.full, 0.3);
      await s.click(nav(s, "日历"), { after: 0.6 });
      saveDownload(s, "export.ics");
      await s.click(s.page.getByRole("button", { name: /导出当前事项/ }), { after: 0.5 });
    });
    await shot(s, "4-3", async () => {
      await s.click(nav(s, "工作台"), { after: 0.4 });
      const sec = s.page.locator(".holiday-section");
      await s.scrollTo(700, 1.0);
      const box = await sec.boundingBox();
      s.zoom([box.x - 420, box.y - 30, 920, 517], 0.6);
      const sel = s.page.getByLabel("节日类型筛选");
      await s.click(sel, { after: 0.2 });
      await s.page.keyboard.press("Escape");
      await sel.selectOption("lunar");
      await s.wait(1.2);
      await sel.selectOption("term");
      await s.wait(1.0);
      await s.click(sec.getByRole("button", { name: /^排除/ }).first(), { after: 0.8 });
    });
  },

  // 段落 5：复制 Tag、建任务、看板
  async create(s) {
    await prep(s);
    await shot(s, "5-1", async () => {
      s.zoom(R.spotlight, 0.6);
      await s.wait(0.5);
      await s.click(s.page.locator(".spotlight").getByRole("button", { name: "复制 Tag" }), { after: 0.3 });
      s.zoom(R.full, 0.6);
      await s.wait(1.5);
    });
    await shot(s, "5-2", async () => {
      await s.click(s.page.locator(".spotlight").getByRole("button", { name: "建任务" }), { after: 0.8 });
      await s.click(s.page.locator(".modal").getByRole("button", { name: "保存任务" }), { after: 0.5 });
      await s.click(nav(s, "任务"), { after: 0.6 });
      const card = s.page.locator(".task-card").first();
      const col = s.page.locator('section.kanban-col[aria-label="进行中任务"]');
      await s.dragNative(card, col, 1.0);
      await s.wait(0.5);
    });
  },

  // 段落 6：其他功能速览。每个镜头前先在镜头外把页面准备好，镜头里只录要展示的动作。
  async features(s) {
    await prep(s);
    const assistant = s.page.locator("[aria-label='AI 创作助手']");
    // 助手面板开着时有一层遮罩，点遮罩关闭面板
    const closeAssistant = async () => {
      const shade = s.page.locator(".assistant-shade");
      for (let i = 0; i < 3 && (await shade.isVisible().catch(() => false)); i++) {
        await shade.click({ position: { x: 20, y: 450 }, force: true }).catch(() => {});
        await sleep(800);
      }
    };
    /** 镜头外切换页面（不录、不放慢） */
    const go = async (name) => {
      await closeAssistant();
      await s.page.keyboard.press("Escape");
      await nav(s, name).click();
      await sleep(1200);
      await s.scrollTo(0, 0.01);
      await sleep(300);
    };
    /** AI 镜头：失败（报错、未能保存）就重录，最多 3 次 */
    const aiShot = async (id, setup, fn, ok) => {
      for (let i = 1; i <= 3; i++) {
        await setup();
        await shot(s, id, fn);
        if (await ok()) return;
        console.warn(`  ! ${id} 第 ${i} 次 AI 结果不理想，重录`);
      }
    };

    await go("角色库");
    await shot(s, "6-1", async () => {
      await s.press("Control+k", 0.4);
      await s.type("露露卡", { cps: 6 });
      await s.wait(0.5);
      await s.move(s.page.locator(".palette-list [role=option]").first(), 0.5);
      await s.wait(0.8);
    });
    await s.page.keyboard.press("Escape");
    await go("选题");
    await shot(s, "6-2", async () => {
      await s.wait(0.3);
      await s.move(s.page.locator(".month-ribbon button").nth(1), 0.6);
      await s.scrollTo(320, 1.4);
    });

    const ask = async (text) => {
      const box = s.page.getByLabel("发送给 AI 助手");
      await s.click(box, { after: 0.1 });
      await s.type(text, { cps: 12 });
      await s.press("Enter", 0.3);
    };
    await aiShot(
      "6-3",
      async () => {
        await go("工作台");
        await s.page.getByRole("button", { name: "AI 助手" }).click();
        await sleep(1000);
        const clear = s.page.getByTitle("清除对话");
        if (await clear.isEnabled().catch(() => false)) {
          s.page.once("dialog", (d) => d.accept().catch(() => {}));
          await clear.click().catch(() => {});
          await sleep(800);
        }
      },
      async () => {
        // 推近对话区，不拍到面板顶部的模型名称
        s.zoom([700, 200, 900, 506], 0.6);
        await ask("把默认提醒改为提前 7 天");
        await s.cut(() =>
          until(s, () => !document.querySelector("[aria-label='AI 正在运行']") && /撤销|未能|失败|错误/.test(document.querySelector("[aria-label='AI 创作助手']")?.innerText || ""), null, 180000),
        );
        await s.wait(1.6);
      },
      async () => {
        const text = await assistant.first().innerText().catch(() => "");
        return /撤销/.test(text) && !/未能保存|请求失败|错误/.test(text);
      },
    );

    await aiShot(
      "6-4",
      async () => {
        await go("选题");
      },
      async () => {
        await s.click(s.page.getByRole("button", { name: "AI 生成选题" }), { after: 0.6 });
        const dialog = s.page.locator(".modal");
        const picked = dialog.locator("input[type=checkbox]:checked");
        if ((await picked.count()) === 0) {
          for (const name of ["森亚露露卡", "香风智乃"]) {
            await s.click(dialog.getByText(name, { exact: true }).first(), { after: 0.2 });
          }
        }
        await s.click(dialog.getByRole("button", { name: "生成选题" }), { after: 0.2 });
        await s.cut(() => until(s, () => !!document.querySelector(".modal .result-list") || /失败|错误/.test(document.querySelector(".modal")?.innerText || ""), null, 240000));
        const list = await dialog.locator(".result-list").boundingBox().catch(() => null);
        if (list) s.zoom([list.x - 40, list.y - 60, list.width + 80, Math.max(list.height + 120, 300)], 0.6);
        await s.wait(1.6);
      },
      async () => (await s.page.locator(".modal .result-list").count()) > 0,
    );
    await s.page.keyboard.press("Escape");

    await go("角色库");
    await shot(s, "6-5", async () => {
      await s.click(s.page.getByRole("button", { name: "标星 和泉纱雾" }).first(), { after: 0.3 });
      await s.click(s.page.locator(".select-menu [aria-haspopup=listbox]").filter({ hasText: "生日临近" }).first(), { after: 0.3 });
      await s.click(s.page.getByRole("option", { name: "标星优先" }), { after: 0.6 });
      await s.click(s.page.getByRole("button", { name: "约会大作战", exact: true }).first(), { after: 0.5 });
    });
    await s.page.getByRole("button", { name: "全部作品" }).first().click();
    await sleep(800);
    await s.page.locator(".character-card").filter({ hasText: "森亚露露卡" }).locator("img").first().click();
    await sleep(1200);
    await shot(s, "6-6", async () => {
      const adj = s.page.getByRole("button", { name: "调整图片位置" });
      await s.move(s.page.locator(".modal img").first(), 0.5);
      await s.click(adj, { after: 0.3 });
      const img = s.page.locator(".modal img").first();
      const ib = await img.boundingBox();
      s.zoom([ib.x - 300, ib.y - 60, 900, 506], 0.5);
      await s.drag({ x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 }, { x: ib.x + ib.width / 2 + 30, y: ib.y + ib.height / 2 + 60 }, 0.8);
      await s.click(s.page.getByRole("button", { name: "保存位置" }), { after: 0.4 });
    });
    await s.page.keyboard.press("Escape");
    await go("工作台");
    await shot(s, "6-7", async () => {
      await s.click(s.page.getByRole("button", { name: "切换到夜间模式" }), { after: 1.2 });
    });
    await go("设置");
    await s.page.locator(".settings-nav").getByText("数据与备份").click();
    await sleep(1000);
    await shot(s, "6-8", async () => {
      saveDownload(s, "backup.json");
      await s.click(s.page.getByRole("button", { name: "导出 JSON" }), { after: 0.8 });
    });
  },

  // 段落 7：和推聊天
  async chat(s) {
    await prep(s);
    await shot(s, "7-1", async () => {
      s.zoom(R.spotlight, 0.8);
      await s.move(s.page.locator(".spotlight").getByRole("button", { name: "和角色聊天" }), 1.0);
    });
    const replies = () => s.page.locator(".chat-log .chat-line.assistant").count();
    const waitReply = async (before) => {
      await s.cut(() =>
        until(
          s,
          (before) => {
            const msgs = document.querySelectorAll(".chat-log .chat-line.assistant");
            const last = msgs[msgs.length - 1];
            return msgs.length > before && last.textContent.trim().length > 2;
          },
          before,
        ),
      );
      await until(s, () => !document.querySelector("[aria-label='停止']"), null, 180000);
    };
    await shot(s, "7-2", async () => {
      await s.click(s.page.locator(".spotlight").getByRole("button", { name: "和角色聊天" }), { after: 0.6 });
      s.zoom(R.full, 0.5);
      const log = await s.page.locator(".chat-log").boundingBox();
      s.zoom([log.x - 30, log.y + 20, log.width + 60, log.height * 0.62], 0.6);
      await s.click(s.page.getByPlaceholder(/说点什么/), { after: 0.1 });
      await s.type("生日快乐！今天想怎么过呀？", { cps: 10 });
      const before = await replies();
      await s.press("Enter", 0.2);
      await waitReply(before);
      await s.wait(0.8);
    });
    await shot(s, "7-3", async () => {
      const log = await s.page.locator(".chat-log").boundingBox();
      s.zoom([log.x - 30, log.y + log.height * 0.3, log.width + 60, log.height * 0.7], 0.6);
      const before = await replies();
      await s.click(s.page.locator(".chat-footer").getByRole("button", { name: /画点啥/ }), { after: 0.2 });
      await waitReply(before);
      await s.wait(0.6);
      await s.move(s.page.getByRole("button", { name: "复制这条消息" }).last(), 0.5);
    });
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(sessions);
for (const name of names) {
  console.log(`=== ${name}`);
  const s = await Stage.open();
  try {
    await sessions[name](s);
  } finally {
    await s.close();
  }
  await sleep(500);
}
