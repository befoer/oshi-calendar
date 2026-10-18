import { expect, it } from "vitest";
import { createServer } from "node:net";
import {
  parseWindowsProxy,
  isLoopbackProxy,
  resolveNetwork,
  proxyPortOpen,
} from "../scripts/network.mjs";

it("解析Windows单地址及按协议配置，不使用SOCKS、密码或附带路径的地址", () => {
  expect(parseWindowsProxy("127.0.0.1:7897")).toBe("http://127.0.0.1:7897/");
  expect(parseWindowsProxy("http=127.0.0.1:8080;https=127.0.0.1:7897")).toBe(
    "http://127.0.0.1:7897/",
  );
  expect(
    parseWindowsProxy("http=127.0.0.1:8080;https=127.0.0.1:7897", "http:"),
  ).toBe("http://127.0.0.1:8080/");
  for (const value of [
    "socks=127.0.0.1:7897",
    "socks5://127.0.0.1:7897",
    "http://u:p@localhost:7897",
    "http://localhost:7897/path",
    "not-a-proxy",
  ])
    expect(parseWindowsProxy(value)).toBeNull();
  expect(isLoopbackProxy("http://localhost:7897")).toBe(true);
  expect(isLoopbackProxy("http://[::1]:7897")).toBe(true);
  expect(isLoopbackProxy("http://192.168.1.1:7897")).toBe(false);
});
it("环境变量优先，系统开启使用系统代理，关闭时只检测已配置且监听中的回环代理", async () => {
  expect(
    (
      await resolveNetwork("https:", {
        environment: { HTTPS_PROXY: "http://localhost:9000" },
        windows: { ProxyEnable: 1, ProxyServer: "localhost:7897" },
      })
    ).mode,
  ).toBe("environment");
  expect(
    (
      await resolveNetwork("https:", {
        environment: {},
        windows: { ProxyEnable: 1, ProxyServer: "localhost:7897" },
      })
    ).mode,
  ).toBe("system");
  let probes = 0;
  const probe = async () => {
    probes++;
    return true;
  };
  expect(
    (
      await resolveNetwork("https:", {
        environment: {},
        windows: { ProxyEnable: 0, ProxyServer: "localhost:7897" },
        probe,
      })
    ).mode,
  ).toBe("local");
  expect(probes).toBe(1);
  expect(
    (
      await resolveNetwork("https:", {
        environment: {},
        windows: { ProxyEnable: 0, ProxyServer: "192.168.1.1:7897" },
        probe,
      })
    ).mode,
  ).toBe("direct");
  expect(probes).toBe(1);
  expect(
    (
      await resolveNetwork("https:", {
        environment: {},
        windows: { ProxyEnable: 0, ProxyServer: "localhost:7897" },
        probe: async () => false,
      })
    ).mode,
  ).toBe("direct");
});
it("配置变更重新解析，真实端口关闭会退回直接连接，检测有时间限制", async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  const proxy = `http://127.0.0.1:${port}`;
  expect(await proxyPortOpen(proxy)).toBe(true);
  expect(
    (
      await resolveNetwork("https:", {
        environment: {},
        windows: { ProxyEnable: 0, ProxyServer: `127.0.0.1:${port}` },
      })
    ).mode,
  ).toBe("local");
  await new Promise<void>((done) => server.close(() => done()));
  expect(await proxyPortOpen(proxy)).toBe(false);
  expect(
    (
      await resolveNetwork("https:", {
        environment: {},
        windows: { ProxyEnable: 0, ProxyServer: `127.0.0.1:${port}` },
      })
    ).mode,
  ).toBe("direct");
});
