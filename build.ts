// Builds the site into dist/. Each page in src/ is a <head> of its own tags and a <body> of its
// content; both go into src/layout.html, which holds everything the pages share, with style.css
// inlined so a page arrives as one response. The markdown in src/docs/ (copies of the Toyon
// repository's docs, see scripts/docs.ts) renders at /docs/<name>, with an index at /docs/.
// The docs are the one dark part of the site: the brand pages are on paper, the docs are read
// beside the app and take its own dark theme (style.css, `.dark`). public/ is copied over as it is.
//
//   bun build.ts            build once
//   bun build.ts --serve    build, rebuild as src/ and public/ change, and serve dist/ on $PORT
//                           (what the Toyon preview runs)

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Marked, type Token } from "marked";

const SRC = "src";
const PUBLIC = "public";
const OUT = "dist";
const DOCS = "docs";
// the docs' reading order on the index; anything not named follows, alphabetically
const ORDER = ["settings", "preview", "agents", "remote", "trust", "policy"];
const REPO = "https://github.com/toyon-dev/toyon/blob/main/docs/";
const RAW = "https://raw.githubusercontent.com/toyon-dev/toyon/main/docs/";

const part = (page: string, tag: string) => page.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1].replace(/^\n+|\n+$/g, "") ?? "";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
// a paragraph of markdown as plain words, for a meta description or an index line
const plain = (md: string) => md.replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
// the first sentences of a text, stopping once there are at least `min` characters
const sentences = (text: string, min: number) => {
  let out = "";
  for (const s of text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text]) {
    out += s;
    if (out.length >= min) break;
  }
  return out.trim();
};

// The docs link each other by file name, which stays on the site; a link out of the folder
// (SECURITY.md, the images) goes to the repository.
const relink = (token: Token) => {
  if (token.type !== "link" && token.type !== "image") return;
  if (/^[a-z]+:|^[#/]/i.test(token.href)) return;
  const doc = token.href.match(/^([\w-]+)\.md(#.*)?$/);
  if (doc) token.href = `/${DOCS}/${doc[1]}${doc[2] ?? ""}`;
  else token.href = new URL(token.href, token.type === "image" ? RAW : REPO).href;
};
const marked = new Marked();

async function build() {
  const layout = await readFile(join(SRC, "layout.html"), "utf8");
  // the stylesheet's comments are for whoever edits it, not the visitor
  const css = (await readFile(join(SRC, "style.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{3,}/g, "\n\n").trim();
  // The layout is written for the light pages; a dark page swaps the scheme class on <html> and
  // the browser chrome's colour, and the stylesheet does the rest.
  const render = (head: string, body: string, scheme: "light" | "dark" = "light") =>
    layout
      .replace('<html lang="en" class="light">', () => `<html lang="en" class="${scheme}">`)
      .replace('<meta name="theme-color" content="#f8f2e8">', () => `<meta name="theme-color" content="${scheme === "dark" ? "#32302d" : "#f8f2e8"}">`)
      .replace("<!-- head -->", () => head)
      .replace("<!-- css -->", () => css)
      .replace("<!-- body -->", () => body);
  await mkdir(OUT, { recursive: true });
  await cp(PUBLIC, OUT, { recursive: true });
  for (const name of await readdir(SRC)) {
    if (!name.endsWith(".html") || name === "layout.html") continue;
    const page = await readFile(join(SRC, name), "utf8");
    await writeFile(join(OUT, name), render(part(page, "head"), part(page, "body")));
  }
  await docs(render);
}

async function docs(render: (head: string, body: string, scheme: "dark") => string) {
  const dir = join(SRC, DOCS);
  const names = ((await readdir(dir).catch(() => [])) as string[])
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -3))
    .sort((a, b) => (ORDER.indexOf(a) + 1 || Infinity) - (ORDER.indexOf(b) + 1 || Infinity) || a.localeCompare(b));
  await mkdir(join(OUT, DOCS), { recursive: true });
  const index: string[] = [];
  for (const name of names) {
    const tokens = marked.lexer(await readFile(join(dir, `${name}.md`), "utf8"));
    marked.walkTokens(tokens, relink);
    const heading = tokens.find((t) => t.type === "heading" && t.depth === 1);
    const lede = tokens.find((t) => t.type === "paragraph");
    const title = heading?.type === "heading" ? plain(heading.text) : name;
    const text = lede?.type === "paragraph" ? plain(lede.text) : "";
    const head = `  <title>${esc(title)}: Toyon</title>\n  <meta name="description" content="${esc(sentences(text, 120))}">`;
    // the way up to the index sits above the title, named for where it goes rather than "back"
    const up = `    <a class="up" href="/${DOCS}/"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.5 3.5 5 8l4.5 4.5M5 8h8"/></svg>Docs</a>\n`;
    const body = `  <main class="prose doc">\n${up}${marked.parser(tokens)}  </main>`;
    await writeFile(join(OUT, DOCS, `${name}.html`), render(head, body, "dark"));
    index.push(`      <li><a href="/${DOCS}/${name}">${esc(title)}</a> <span>${esc(sentences(text, 1))}</span></li>`);
  }
  const head = `  <title>Docs: Toyon</title>\n  <meta name="description" content="What Toyon reads, runs and refuses: the settings file, the preview, the agents, running it off your laptop, trust and policy.">`;
  const body = `  <main class="prose">
    <h1>Docs</h1>
    <p>The same pages as the <a href="https://github.com/toyon-dev/toyon/tree/main/docs">repository's docs folder</a>, as of the last release.</p>
    <ul class="docs">
${index.join("\n")}
    </ul>
  </main>`;
  await writeFile(join(OUT, DOCS, "index.html"), render(head, body, "dark"));
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
      // clean URLs as Cloudflare Pages serves them: /impressum is impressum.html, /docs is docs/
      if (path.endsWith("/")) path += "index.html";
      else if (!/\.[a-z0-9]+$/i.test(path)) path = (await Bun.file(resolve(root, `.${path}.html`)).exists()) ? `${path}.html` : `${path}/index.html`;
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(root + sep) || !(await Bun.file(file).exists())) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(file));
    },
  });
  console.log(`serving ${OUT}/ on ${server.url}`);
}
