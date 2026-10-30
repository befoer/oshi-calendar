import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default async function portableRelease(context) {
  const portable = context.artifactPaths.find((path) =>
    /oshi-calendar-\d+\.\d+\.\d+-portable\.exe$/.test(path),
  );
  if (!portable) return [];
  const version = /oshi-calendar-(\d+\.\d+\.\d+)-portable\.exe$/.exec(
    portable,
  )[1];
  const file = `oshi-calendar-${version}-portable.exe`;
  const bytes = await readFile(join(context.outDir, file));
  const path = join(context.outDir, "portable-update.json");
  await writeFile(
    path,
    JSON.stringify(
      {
        version,
        file,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      },
      null,
      2,
    ),
  );
  return [path];
}
