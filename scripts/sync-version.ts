import { $ } from "bun";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

// Get latest git tag
const tag = (await $`git describe --tags --abbrev=0`.text()).trim();
const version = tag.replace(/^v/, "");

// Update package.json
const pkgPath = join(root, "package.json");
const pkg = await Bun.file(pkgPath).json();
const oldVersion = pkg.version;
if (oldVersion === version) {
  console.log(`Version already ${version}, nothing to do.`);
  process.exit(0);
}
pkg.version = version;
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Update electrobun.config.ts
const ebPath = join(root, "electrobun.config.ts");
const ebContent = await Bun.file(ebPath).text();
const ebUpdated = ebContent.replace(
  /version:\s*"[^"]*"/,
  `version: "${version}"`,
);
await Bun.write(ebPath, ebUpdated);

console.log(`Version synced: ${oldVersion} → ${version}`);
