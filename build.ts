// Builds the site into dist/. Each page in src/ is a <head> of its own tags and a <body> of its
// content; both go into src/layout.html, which holds everything the pages share, with style.css
// inlined so a page arrives as one response. public/ is copied over as it is.
//
//   bun build.ts            build once
//   bun build.ts --serve    build, rebuild as src/ and public/ change, and serve dist/ on $PORT
//                           (what the Toyon preview runs)

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const SRC = "src";
const PUBLIC = "public";
const OUT = "dist";

const part = (page: string, tag: string) => page.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1].replace(/^\n+|\n+$/g, "") ?? "";

async function build() {
  const layout = await readFile(join(SRC, "layout.html"), "utf8");
  // the stylesheet's comments are for whoever edits it, not the visitor
  const css = (await readFile(join(SRC, "style.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{3,}/g, "\n\n").trim();
  await mkdir(OUT, { recursive: true });
  await cp(PUBLIC, OUT, { recursive: true });
  for (const name of await readdir(SRC)) {
    if (!name.endsWith(".html") || name === "layout.html") continue;
    const page = await readFile(join(SRC, name), "utf8");
    const html = layout
      .replace("<!-- head -->", () => part(page, "head"))
      .replace("<!-- css -->", () => css)
      .replace("<!-- body -->", () => part(page, "body"));
    await writeFile(join(OUT, name), html);
  }
}

if (!process.argv.includes("--serve")) {
  await rm(OUT, { recursive: true, force: true });
  await build();
} else {
  await build();
  // A poll of the sources' mtimes rather than fs.watch: a dozen files, and it works the same
  // everywhere, sandboxes included.
  const stamp = async () => {
    let sum = 0;
    for (const dir of [SRC, PUBLIC]) {
      for (const f of await readdir(dir, { recursive: true })) sum += (await stat(join(dir, f))).mtimeMs;
    }
    return sum;
  };
  let last = await stamp();
  setInterval(async () => {
    const now = await stamp();
    if (now === last) return;
    last = now;
    await build().catch(console.error);
  }, 300);
  const root = resolve(OUT);
  const server = Bun.serve({
    port: Number(process.env.PORT) || 3000,
    async fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      if (path.endsWith("/")) path += "index.html";
      // clean URLs as Cloudflare Pages serves them: /impressum is impressum.html
      else if (!/\.[a-z0-9]+$/i.test(path)) path += ".html";
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(root + sep) || !(await Bun.file(file).exists())) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(file));
    },
  });
  console.log(`serving ${OUT}/ on ${server.url}`);
}
