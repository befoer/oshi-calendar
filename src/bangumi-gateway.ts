import { getBangumiConnection } from "./bangumi-connection";

export const BANGUMI_GATEWAY_URL = (
  import.meta.env.VITE_BANGUMI_GATEWAY_URL || "https://bangumi-api.acg-dna.top"
).replace(/\/$/, "");

/** Keep Bangumi's thumbnail size while avoiding the blocked image host. */
export function bangumiImageGatewayURL(source: string): string | null {
  if (getBangumiConnection() === "direct") return null;
  try {
    const image = new URL(source);
    if (
      !["http:", "https:"].includes(image.protocol) ||
      image.hostname !== "lain.bgm.tv" ||
      image.port ||
      image.username ||
      image.password ||
      !/^\/(?:r\/[1-9]\d{0,3}\/)?pic\//.test(image.pathname)
    )
      return null;
    image.protocol = "https:";
    const gateway = new URL(BANGUMI_GATEWAY_URL + "/v1/image");
    gateway.searchParams.set("url", image.toString());
    return gateway.toString();
  } catch {
    return null;
  }
}
