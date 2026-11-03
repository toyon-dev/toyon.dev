// Copies the docs out of a Toyon checkout into src/docs/, where build.ts renders them at
// /docs/<name>. The checkout is the argument, or ../toyon beside this repository's main checkout.
// The copies are committed, so the site builds offline and a sync shows up as a diff; run it after
// a Toyon release, then commit what changed.
//
//   bun scripts/docs.ts [path/to/toyon]

import { $ } from "bun";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const common = (await $`git rev-parse --path-format=absolute --git-common-dir`.text()).trim();
const toyon = resolve(process.argv[2] ?? join(common, "..", "..", "toyon"));
const from = join(toyon, "docs");
const to = join("src", "docs");

const names = (await readdir(from).catch(() => null))?.filter((n) => n.endsWith(".md")).sort();
if (!names?.length) {
  console.error(`no docs at ${from}; pass the path to a Toyon checkout`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const name of names) await cp(join(from, name), join(to, name));

const rev = (await $`git -C ${toyon} rev-parse --short HEAD`.text()).trim();
console.log(`${names.length} docs from ${toyon} at ${rev}: ${names.join(" ")}`);
