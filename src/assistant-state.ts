import { z } from "zod";
import { db } from "./store";
import type { Pending, AssistantProgress } from "./ai";
import { webPageSchema, type WebPage } from "./web";

export type AssistantCheckpoint = {
  requestId: string;
  messages: any[];
  pages: [string, WebPage][];
  callResults: [string, any][];
  logIds: string[];
  modified: number;
  round: number;
  calls: any[];
  cursor: number;
  activity: Extract<AssistantProgress, { type: "tool" }>[];
  status: "running" | "interrupted" | "pending";
  error?: string;
  pending?: Pending;
};
const checkpointSchema = z.object({
  requestId: z.string().min(1),
  messages: z.array(z.any()).max(600),
  pages: z.array(z.tuple([z.string(), webPageSchema])),
  callResults: z.array(z.tuple([z.string(), z.any()])),
  logIds: z.array(z.string()),
  modified: z.number().int().min(0).max(50),
  round: z.number().int().min(0).max(8),
  calls: z.array(z.any()).max(50),
  cursor: z.number().int().min(0).max(50),
  activity: z.array(z.any()),
  status: z.enum(["running", "interrupted", "pending"]),
  error: z.string().optional(),
  pending: z.any().optional(),
});
export async function loadAssistantCheckpoint(): Promise<
  AssistantCheckpoint | undefined
> {
  const saved = await db.assistantRuns.get("active");
  const parsed = checkpointSchema.safeParse(saved?.state);
  return parsed.success ? (parsed.data as AssistantCheckpoint) : undefined;
}
export async function saveAssistantCheckpoint(state: AssistantCheckpoint) {
  await db.assistantRuns.put({
    id: "active",
    updatedAt: new Date().toISOString(),
    state: structuredClone(state),
  });
}
export async function clearAssistantCheckpoint() {
  await db.assistantRuns.delete("active");
}

// Retain the full original locally for quote validation; send compact verbatim
// passages to the model, so long wiki pages do not drown out dates and caveats.
export function focusWebPage(page: WebPage): WebPage {
  if (page.text.length <= 6000) return page;
  const windows: [number, number][] = [[0, 1000]];
  for (const match of page.text.matchAll(
    /birthday|birth date|date of birth|生日|誕生日|出生日期|記念日|anniversary|未公開|秘密/gi,
  )) {
    windows.push([
      Math.max(0, match.index - 220),
      Math.min(page.text.length, match.index + 500),
    ]);
    if (windows.length >= 18) break;
  }
  windows.sort(([a], [b]) => a - b);
  const merged: [number, number][] = [];
  for (const [start, end] of windows) {
    const prior = merged.at(-1);
    if (prior && start <= prior[1]) prior[1] = Math.max(prior[1], end);
    else merged.push([start, end]);
  }
  return {
    ...page,
    text: merged
      .map(([start, end]) => page.text.slice(start, end))
      .join("\n[省略部分正文]\n")
      .slice(0, 6000),
    truncated: true,
  };
}
