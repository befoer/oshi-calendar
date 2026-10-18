import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const svg = await readFile("public/icon.svg", "utf8");
const render = async (size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0">${svg.replace("viewBox=", `width="${size}" height="${size}" viewBox=`)}</body>`,
  );
  return page.screenshot({ omitBackground: true });
};
// PWA / 浏览器图标
for (const size of [192, 512]) {
  await writeFile(`public/icon-${size}.png`, await render(size));
}
// Windows 启动器（推日.exe）使用的多尺寸 ICO：每个尺寸都是 PNG 图像
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const size of sizes) images.push(await render(size));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
await writeFile("scripts/launcher.ico", Buffer.concat([header, ...images]));
await browser.close();
