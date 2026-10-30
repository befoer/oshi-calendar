import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
export const VIDEO_DIR = resolve(here, "..");
export const PROFILE_DIR = resolve(VIDEO_DIR, "素材/profile");
export const REC_DIR = resolve(VIDEO_DIR, "素材/rec");
export const APP_URL = "http://127.0.0.1:4190/";
// 演示日期：森亚露露卡生日（11/1），之后是香风智乃、和泉纱雾、白
export const DEMO_TIME = "2026-11-01T10:00:00+08:00";
