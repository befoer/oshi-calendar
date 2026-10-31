import { extractFile, listPackage } from "@electron/asar";
import { join } from "node:path";

// Fail before creating distributables if a profile, fixture, or unexpected file
// slips into the application archive. Existing user profiles are never changed.
export default async function auditPackage(context) {
  const archive = join(context.appOutDir, "resources", "app.asar");
  const paths = listPackage(archive).map((path) =>
    path.replaceAll("\\", "/").replace(/^\//, ""),
  );
  const allowed =
    /^(?:dist(?:\/|$)|electron-dist(?:\/|$)|electron(?:\/preload\.cjs)?$|scripts(?:\/launcher\.ico)?$|package\.json$)/;
  const forbidden =
    /(?:^|\/)(?:推日数据|\.electron-data|test-fixtures|IndexedDB|Local Storage|Session Storage|Cookies|\.env(?:\.[^/]*)?)(?:\/|$)|\.(?:test\.[cm]?[jt]sx?|sqlite3?|db|log|map)$/i;
  for (const path of paths) {
    if (!allowed.test(path) || forbidden.test(path))
      throw new Error(`Unexpected file in release package: ${path}`);
    if (/^dist\/.*\.js$/.test(path)) {
      const source = extractFile(archive, join(...path.split("/"))).toString("utf8");
      if (
        /seed-\d|fixture-\d|test_character_\d|sk-[a-zA-Z0-9_-]{24,}|AIza[0-9A-Za-z_-]{30,}/.test(
          source,
        )
      )
        throw new Error(
          `Seed, test data, or credential detected in release script: ${path}`,
        );
    }
  }
  console.log(`Release privacy audit passed (${paths.length} archive entries)`);
}
