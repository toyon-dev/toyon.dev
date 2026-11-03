// Encodes the page's pictures as AVIF beside their JPGs, to run after a re-shoot (scripts/shots.ts
// writes the JPGs). The window gets a 1x cut as well as the 2x capture, for ordinary screens.
//
//   bun scripts/avif.ts
//
// Needs sharp, which Bun's auto-install stalls on (its native build is split into platform
// packages), so the first run installs it into a scratch folder under the temp dir and later runs
// find it there; the repo keeps no package.json.

import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = join(tmpdir(), "toyon-dev-avif");
if (!existsSync(join(scratch, "node_modules", "sharp"))) {
  mkdirSync(scratch, { recursive: true });
  await Bun.$`bun add sharp`.cwd(scratch).quiet();
}
const sharp = (await import(join(scratch, "node_modules", "sharp"))).default;

const dir = join(import.meta.dir, "..", "public", "media");
const avif = (quality: number) => ({ quality, effort: 6 });

await sharp(join(dir, "window.jpg")).avif(avif(50)).toFile(join(dir, "window.avif"));
await sharp(join(dir, "window.jpg")).resize({ width: 1400 }).avif(avif(60)).toFile(join(dir, "window-1400.avif"));
for (const name of ["ask", "phone", "rail"]) {
  await sharp(join(dir, `${name}.jpg`)).avif(avif(60)).toFile(join(dir, `${name}.avif`));
}
