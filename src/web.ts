import { z } from "zod";
const networkSchema = z
  .object({
    mode: z.enum(["environment", "system", "local", "direct"]),
    label: z.string(),
  })
  .optional();

export const webPageSchema = z.object({
  success: z.literal(true),
  url: z.string().url(),
  title: z.string(),
  text: z.string().min(1).max(30000),
  truncated: z.boolean(),
  network: networkSchema,
});
const searchSchema = z.object({
  success: z.literal(true),
  provider: z.string(),
  query: z.string(),
  network: networkSchema,
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        snippet: z.string(),
      }),
    )
    .max(8),
});
export type WebPage = z.infer<typeof webPageSchema>;
export async function webRequest(
  kind: "search" | "read",
  input: unknown,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`/__huiqi_web/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
    });
  } catch (error) {
    if (signal.aborted) throw new Error("已取消网页查询");
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new Error("网页查询超时，请打开 VPN／代理后重试");
    throw new Error(
      "网页查询无法连接，请检查网络和 VPN／代理，并通过 start.cmd 启动本地服务",
    );
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "网页检索服务未启动，请双击 start.cmd；纯静态托管不支持网页检索",
    );
  }
  if (!response.ok || body.success !== true)
    throw new Error(body.error || "网页检索服务不可用，请双击 start.cmd 启动");
  return kind === "search"
    ? searchSchema.parse(body)
    : webPageSchema.parse(body);
}
