import { app } from "electron";
import { join } from "node:path";

// Isolate the real bundled main process from the user's desktop profile.
app.setPath("appData", process.env.OSHI_SMOKE_ROOT);
const getPath = app.getPath.bind(app);
app.getPath = (name) => name === "exe" ? join(process.env.OSHI_SMOKE_ROOT, "推日.exe") : getPath(name);
Object.defineProperty(app, "isPackaged", { value: true });
await import("../../electron-dist/main.mjs");
