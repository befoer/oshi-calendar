export type NetworkRoute = {
  mode: "environment" | "system" | "local" | "direct";
  label: string;
  proxy: string | null;
};
export function parseWindowsProxy(
  raw: unknown,
  protocol?: string,
): string | null;
export function isLoopbackProxy(input: string): boolean;
export function proxyPortOpen(input: string): Promise<boolean>;
export function resolveNetwork(
  protocol?: string,
  options?: {
    environment?: Record<string, string>;
    windows?: {
      ProxyEnable?: number;
      ProxyServer?: string;
      AutoConfigURL?: string;
    };
    probe?: (proxy: string) => Promise<boolean>;
  },
): Promise<NetworkRoute>;
