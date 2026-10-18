import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { handleWebTools, webVersion } from "./web-tools.mjs";
import { createHash } from "node:crypto";
const serverVersion = createHash("sha256")
  .update(await readFile(new URL("./serve.mjs", import.meta.url)))
  .update(await readFile(new URL("./web-tools.mjs", import.meta.url)))
  .update(await readFile(new URL("./network.mjs", import.meta.url)))
  .digest("hex");
const root = resolve("dist");
const port = Number(process.env.HUIQI_PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};
createServer(async (req, res) => {
  res.setHeader("X-Huiqi-App", "creation-calendar");
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/__huiqi_health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          app: "huiqi",
          root,
          webVersion,
          serverVersion,
          pid: process.pid,
        }),
      );
      return;
    }
    if (await handleWebTools(req, res)) return;
    const file = resolve(root, "." + path);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let target = file;
    try {
      if (!(await stat(file)).isFile()) target = resolve(root, "index.html");
    } catch {
      if (extname(path)) {
        res.writeHead(404);
        res.end();
        return;
      }
      target = resolve(root, "index.html");
    }
    const content = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(500);
    res.end("Unable to serve application");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Huiqi running at http://127.0.0.1:${port}`),
);
