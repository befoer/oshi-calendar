import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { bangumiImageGatewayURL } from "./bangumi-gateway";
import { localizeAvatar } from "./avatars";
import { setBangumiConnection } from "./bangumi-connection";

afterEach(() => {
  setBangumiConnection("gateway");
  vi.unstubAllGlobals();
});

const thumbnail =
  "https://lain.bgm.tv/r/400/pic/crt/l/35/0e/72355_crt_6Z6zM.jpg?r=1602429332";

it("Bangumi 头像使用配置网关，并保留缩略图尺寸和版本参数", () => {
  const gateway = new URL(bangumiImageGatewayURL(thumbnail)!);
  expect(gateway.origin).toBe("https://bangumi-api.acg-dna.top");
  expect(gateway.pathname).toBe("/v1/image");
  expect(gateway.searchParams.get("url")).toBe(thumbnail);
  expect(bangumiImageGatewayURL(thumbnail.replace("https:", "http:"))).toBe(
    gateway.toString(),
  );
});

it.each([
  "https://s4.anilist.co/file/portrait.png",
  "https://example.com/pic/avatar.jpg",
  "https://lain.bgm.tv.evil.example/pic/avatar.jpg",
  "https://lain.bgm.tv/private.jpg",
  "https://lain.bgm.tv/r/invalid/pic/avatar.jpg",
  "https://user:password@lain.bgm.tv/pic/avatar.jpg",
  "https://lain.bgm.tv:8443/pic/avatar.jpg",
  "data:image/png;base64,AAAA",
  "",
])("其他来源和非图片路径不改写到 Bangumi 网关：%s", (source) => {
  expect(bangumiImageGatewayURL(source)).toBeNull();
});

function stubImageConversion() {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 400, height: 600, close })),
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => "data:image/webp;base64,AAAA",
    }),
  });
  return close;
}

it("保存头像先从网关下载，成功后无需本机服务或直连源站", async () => {
  vi.stubGlobal("location", { hostname: "127.0.0.1" });
  const close = stubImageConversion();
  const request = vi.fn(
    async (_source: unknown) =>
      new Response(new Blob(["image"], { type: "image/jpeg" })),
  );
  vi.stubGlobal("fetch", request);
  expect(await localizeAvatar(thumbnail)).toBe("data:image/webp;base64,AAAA");
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0]?.[0])).toBe(
    bangumiImageGatewayURL(thumbnail),
  );
  expect(close).toHaveBeenCalledOnce();
});

it("图片网关失败时，头像仍可通过原有本机服务保存", async () => {
  vi.stubGlobal("location", { hostname: "127.0.0.1" });
  stubImageConversion();
  const request = vi.fn(async (source: string) => {
    if (source.startsWith("https://bangumi-api.acg-dna.top/"))
      return new Response(null, { status: 502 });
    expect(source).toBe(
      `/__huiqi_character/image?url=${encodeURIComponent(thumbnail)}`,
    );
    return new Response(new Blob(["image"], { type: "image/jpeg" }));
  });
  vi.stubGlobal("fetch", request);
  expect(await localizeAvatar(thumbnail)).toBe("data:image/webp;base64,AAAA");
  expect(request).toHaveBeenCalledTimes(2);
});

it("手动直连时头像显示与保存均跳过网关", async () => {
  setBangumiConnection("direct");
  vi.stubGlobal("location", { hostname: "127.0.0.1" });
  stubImageConversion();
  expect(bangumiImageGatewayURL(thumbnail)).toBeNull();
  const request = vi.fn(async (source: string) => {
    expect(source).toBe(thumbnail);
    return new Response(new Blob(["image"], { type: "image/jpeg" }));
  });
  vi.stubGlobal("fetch", request);
  expect(await localizeAvatar(thumbnail)).toBe("data:image/webp;base64,AAAA");
  expect(request).toHaveBeenCalledOnce();
});
