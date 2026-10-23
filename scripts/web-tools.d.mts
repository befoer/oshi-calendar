import type { IncomingMessage, ServerResponse } from "node:http";
export const webVersion: string;
export function handleWebTools(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>;
export function publicAddress(address: string): boolean;
export function publicURL(
  input: string,
  network?: { mode: string },
): Promise<URL>;
export function extractPage(
  html: string,
  url: string,
): { url: string; title: string; text: string; truncated: boolean };
export function parseSearch(
  html: string,
  provider: string,
): { title: string; url: string; snippet: string }[];
