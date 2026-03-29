/**
 * Electrobun postBuild hook — signs native libraries in Resources/app/
 * that Electrobun's built-in codesigning doesn't reach (it only signs Contents/MacOS/).
 *
 * Available env vars from Electrobun:
 *   ELECTROBUN_BUILD_DIR, ELECTROBUN_APP_NAME, ELECTROBUN_BUILD_ENV,
 *   ELECTROBUN_DEVELOPER_ID (from user env)
 */
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DEVELOPER_ID = process.env.ELECTROBUN_DEVELOPER_ID;
const BUILD_DIR = process.env.ELECTROBUN_BUILD_DIR;
const APP_NAME = process.env.ELECTROBUN_APP_NAME;

if (!DEVELOPER_ID) {
  console.log("postBuild: No ELECTROBUN_DEVELOPER_ID, skipping native lib signing");
  process.exit(0);
}

if (!BUILD_DIR || !APP_NAME) {
  console.log("postBuild: No BUILD_DIR or APP_NAME, skipping");
  process.exit(0);
}

const resourcesPath = join(BUILD_DIR, `${APP_NAME}.app`, "Contents", "Resources");

function findDylibs(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...findDylibs(fullPath));
      } else if (entry.endsWith(".dylib")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist, skip
  }
  return results;
}

const dylibs = findDylibs(resourcesPath);

for (const dylib of dylibs) {
  console.log(`postBuild: Signing ${dylib}`);
  execSync(
    `codesign --force --verbose --timestamp --options runtime --sign "${DEVELOPER_ID}" "${dylib}"`,
  );
}

console.log(`postBuild: Signed ${dylibs.length} native libraries`);
