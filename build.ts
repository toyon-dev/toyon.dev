// Builds the site into dist/. Each page in src/ is a <head> of its own tags and a <body> of its
// content; both go into src/layout.html, which holds everything the pages share, with style.css
// inlined so a page arrives as one response. The markdown in src/docs/ (copies of the Toyon
// repository's docs, see scripts/docs.ts) renders at /docs/<name>, with an index at /docs/.
// The docs are the one dark part of the site: the brand pages are on paper, the docs are read
// beside the app and take its own dark theme (style.css, `.dark`). public/ is copied over as it is.
//
//   bun build.ts            build once
//   bun build.ts --serve    build, rebuild as src/, public/ or this file change, and serve dist/
//                           on $PORT (what the Toyon preview runs)
//   bun build.ts --again    build without clearing dist/ first (what --serve runs on a change)

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Marked, type Token } from "marked";

const SRC = "src";
const PUBLIC = "public";
const OUT = "dist";
const DOCS = "docs";
// the docs' reading order on the index; anything not named follows, alphabetically
const ORDER = ["install", "using", "features", "settings", "backends", "commands", "preview", "agents", "phone", "remote", "trust", "policy"];
// The line under each doc's title on the index. A doc's own opening is written for someone
// already on the page; this one is for someone choosing a page, so it names what they would come
// looking for: a list of what is on the page, not a sentence about it. It is inline markdown, so
// a command is set as code the way the docs set it. A doc with no line here (one just synced
// from the Toyon repository) shows its first sentence until it is given one.
const LINES: Record<string, string> = {
  install: "Requirements, updates and uninstalling.",
  using: "Chats, the preview, permission modes and landing.",
  features: "What Toyon does automatically, and every feature with its shortcut.",
  settings: "The settings file: setup, run, check, land and ports.",
  backends: "Sharing a backend between chats, and a database per chat.",
  commands: "Every `toyon` command.",
  preview: "The picker, and what the agent is told about your page.",
  agents: "Claude Code, Codex and OpenCode, compared.",
  phone: "Open Toyon from your phone or another computer.",
  remote: "Run Toyon on your own domain, Tailscale, Fly or another host.",
  trust: "The sandbox, permission modes, what an agent can still reach, telemetry.",
  policy: "What IT can turn off on a company machine.",
};
const REPO = "https://github.com/toyon-dev/toyon/blob/main/docs/";
const RAW = "https://raw.githubusercontent.com/toyon-dev/toyon/main/docs/";

// a page's <head> or <body>, less its comments: like the stylesheet's, they are for whoever
// edits the page, not the visitor
const part = (page: string, tag: string) =>
  page
    .match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]
    .replace(/[ \t]*<!--[\s\S]*?-->\n?/g, "")
    .replace(/^\n+|\n+$/g, "") ?? "";
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
// Every heading under a doc's title gets an id from its words, the way GitHub makes them, so the
// docs' own `settings.md#keys` links land on the section and a visitor can link to one. The link
// glyph beside it is drawn to the shell's icon rules (shell ui/Icon.tsx: a 16px box, the drawing
// filling 12px of it, one 1.3 stroke), since the set has no link glyph of its own; the check it
// turns into for a moment after a click is the shell's own.
const LINK =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path class="link" d="M6.3 9.7 9.7 6.3 M8.4 11.6l-1.5 1.5a2.6 2.6 0 0 1-3.68-3.68l1.5-1.5 M7.6 4.4l1.5-1.5a2.6 2.6 0 0 1 3.68 3.68l-1.5 1.5"/><path class="check" d="M3.4 8.4 6.4 11.4 12.6 4.6"/></svg>';
let slugs = new Set<string>();
const slug = (text: string) => {
  const base = plain(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  let id = base;
  for (let n = 1; slugs.has(id); n++) id = `${base}-${n}`;
  slugs.add(id);
  return id;
};
// the headings of the doc being rendered, in the order they are drawn, for its outline
let heads: { level: number; id: string; text: string }[] = [];
const marked = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      const inner = this.parser.parseInline(tokens);
      const id = depth === 1 ? "" : slug(text);
      heads.push({ level: depth, id, text: plain(text) });
      if (depth === 1) return `<h1>${inner}</h1>\n`;
      // a heading that is one code span and nothing else is a literal name (a key, a tool, a
      // command), which the stylesheet marks apart from a heading that only mentions one
      const name = tokens.length === 1 && tokens[0].type === "codespan" ? ' class="name"' : "";
      return `<h${depth} id="${id}"${name}>${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">${LINK}</a></h${depth}>\n`;
    },
  },
});
// A doc's outline, the one the app draws beside a document (shell ui/Document.tsx): a strip of
// ticks in the left margin, one per heading and as wide as its level is high, which opens into
// the titles under the pointer. The titles are the sections' own links, so they work with no
// script, and the keyboard and a screen reader get them as a list of contents; the ticks are
// only the picture of it. A title steps in once per open heading of a lower level above it, as
// the shell's outlineDepths counts: the doc's title opens none, so an h2 stands at the margin
// and an h3 under it is one step in. The title's own link is the top of the page.
const outline = () => {
  // an outline of one heading says nothing the title does not
  if (heads.length < 2) return "";
  const open: number[] = [];
  const ticks: string[] = [];
  const rows: string[] = [];
  for (const { level, id, text } of heads) {
    while (open.length && open.at(-1)! >= level) open.pop();
    const depth = level === 1 ? 0 : open.length;
    if (level > 1) open.push(level);
    ticks.push(`<span data-level="${level}"></span>`);
    rows.push(`      <li><a href="#${id}" data-level="${level}"${depth ? ` style="--depth: ${depth}"` : ""}>${esc(text)}</a></li>`);
  }
  return `  <nav class="outline" aria-label="Sections">
    <div class="ticks" aria-hidden="true">${ticks.join("")}</div>
    <ol>
${rows.join("\n")}
    </ol>
  </nav>\n`;
};

async function build() {
  const layout = await readFile(join(SRC, "layout.html"), "utf8");
  // the stylesheet's comments are for whoever edits it, not the visitor
  const css = (await readFile(join(SRC, "style.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{3,}/g, "\n\n").trim();
  // The layout is written for the light pages; a dark page swaps the scheme class on <html> and
  // the browser chrome's colour, drops the nav's Docs link (the reader is already there), and
  // the stylesheet does the rest.
  const render = (head: string, body: string, scheme: "light" | "dark" = "light") =>
    layout
      .replace('<html lang="en" class="light">', () => `<html lang="en" class="${scheme}">`)
      .replace('<meta name="theme-color" content="#f8f2e8">', () => `<meta name="theme-color" content="${scheme === "dark" ? "#32302d" : "#f8f2e8"}">`)
      .replace(/\n\s*<a href="\/docs\/">Docs<\/a>(?=\n\s*<a class="github")/, () => (scheme === "dark" ? "" : '\n      <a href="/docs/">Docs</a>'))
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

// A doc's own script. Escape goes up to the index, the way it shuts a panel in the app; the
// index itself is the top of the docs and takes no key. Unannounced: whoever reaches for it
// finds it, and nobody else is told about a key. It goes on keyup: Firefox reads Escape as
// Stop, so a load started on the keydown is cancelled by the same press. A plain click on a
// section's link is still the link (the fragment lands in the address bar, and a modifier or
// the middle button opens it wherever they would) and also puts the whole address on the
// clipboard, the glyph turning into a check for a moment to say so. Where the clipboard is
// refused, the link alone remains. The outline marks the section being read, on its tick and
// on its title: the last heading to have reached the top edge, counted as reached a little
// under it so the one just jumped to is the one marked, and the last heading of all once the
// page is at its end, where a short last section never gets that high. The title's link goes
// to the top without leaving a bare # in the address.
const SCRIPT = `  <script>
    const plain = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    addEventListener("keyup", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      location.assign("/${DOCS}/");
    });
    for (const a of document.querySelectorAll(".anchor")) {
      a.addEventListener("click", (e) => {
        if (!plain(e)) return;
        navigator.clipboard?.writeText(a.href).then(() => {
          a.classList.add("copied");
          setTimeout(() => a.classList.remove("copied"), 1200);
        }, () => {});
      });
    }
    const outline = document.querySelector(".outline");
    if (outline) {
      const heads = document.querySelectorAll(".doc :is(h1, h2, h3, h4, h5, h6)");
      const ticks = outline.querySelectorAll(".ticks span");
      const rows = outline.querySelectorAll("a");
      let at = -1;
      let frame = 0;
      const read = () => {
        frame = 0;
        let i = 0;
        heads.forEach((h, k) => {
          if (h.getBoundingClientRect().top <= 48) i = k;
        });
        if (scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1) i = heads.length - 1;
        if (i === at) return;
        ticks[at]?.classList.remove("current");
        rows[at]?.removeAttribute("aria-current");
        at = i;
        ticks[at]?.classList.add("current");
        rows[at]?.setAttribute("aria-current", "true");
      };
      addEventListener("scroll", () => (frame ||= requestAnimationFrame(read)), { passive: true });
      read();
      rows[0]?.addEventListener("click", (e) => {
        if (!plain(e) || rows[0].getAttribute("href") !== "#") return;
        e.preventDefault();
        scrollTo({ top: 0 });
        history.replaceState(null, "", location.pathname + location.search);
      });
    }
  </script>`;

async function docs(render: (head: string, body: string, scheme: "dark") => string) {
  const dir = join(SRC, DOCS);
  const names = ((await readdir(dir).catch(() => [])) as string[])
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -3))
    .sort((a, b) => (ORDER.indexOf(a) + 1 || Infinity) - (ORDER.indexOf(b) + 1 || Infinity) || a.localeCompare(b));
  await mkdir(join(OUT, DOCS), { recursive: true });
  const index: string[] = [];
  for (const name of names) {
    slugs = new Set();
    heads = [];
    const tokens = marked.lexer(await readFile(join(dir, `${name}.md`), "utf8"));
    marked.walkTokens(tokens, relink);
    const heading = tokens.find((t) => t.type === "heading" && t.depth === 1);
    const lede = tokens.find((t) => t.type === "paragraph");
    const title = heading?.type === "heading" ? plain(heading.text) : name;
    const text = lede?.type === "paragraph" ? plain(lede.text) : "";
    const head = `  <title>${esc(title)}: Toyon</title>\n  <meta name="description" content="${esc(sentences(text, 120))}">`;
    // the way up to the index sits above the title, named for where it goes rather than "back"
    const up = `    <a class="up" href="/${DOCS}/"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.5 3.5 5 8l4.5 4.5M5 8h8"/></svg>Docs</a>\n`;
    const html = marked.parser(tokens);
    // ahead of the page in the source, so the keyboard reaches the contents before the text
    const body = `${outline()}  <main class="prose doc">\n${up}${html}  </main>\n${SCRIPT}`;
    await writeFile(join(OUT, DOCS, `${name}.html`), render(head, body, "dark"));
    if (!LINES[name]) console.warn(`docs index: no line for ${name}; showing its first sentence`);
    index.push(`      <li><a href="/${DOCS}/${name}">${esc(title)}</a> <span>${LINES[name] ? marked.parseInline(LINES[name]) : esc(sentences(text, 1))}</span></li>`);
  }
  const head = `  <title>Docs: Toyon</title>\n  <meta name="description" content="Toyon docs: install, using, features, settings, backends, commands, preview, agents, phone and other devices, your own server, trust, managed policy.">`;
  // the list is the page; the title is for the outline and a screen reader, not the eye
  const body = `  <main class="prose index">
    <h1 class="sr-only">Docs</h1>
    <ul class="docs">
${index.join("\n")}
    </ul>
  </main>`;
  await writeFile(join(OUT, DOCS, "index.html"), render(head, body, "dark"));
}

const SELF = import.meta.path;
if (!process.argv.includes("--serve")) {
  if (!process.argv.includes("--again")) await rm(OUT, { recursive: true, force: true });
  await build();
} else {
  await build();
  // A poll of the sources' mtimes rather than fs.watch: a dozen files, and it works the same
  // everywhere, sandboxes included. This file counts as a source too, and a change runs the
  // build as a fresh process, since the one here keeps the code it started with: a serve left
  // running across an edit to the renderer would otherwise keep writing the old pages over the
  // new ones every time a source moved.
  const stamp = async () => {
    let sum = (await stat(SELF)).mtimeMs;
    for (const dir of [SRC, PUBLIC]) {
      for (const f of await readdir(dir, { recursive: true })) sum += (await stat(join(dir, f))).mtimeMs;
    }
    return sum;
  };
  let last = await stamp();
  let building = false;
  setInterval(async () => {
    const now = await stamp();
    if (now === last || building) return;
    last = now;
    building = true;
    const run = Bun.spawn(["bun", SELF, "--again"], { stdout: "inherit", stderr: "inherit" });
    if ((await run.exited) !== 0) console.error("build failed");
    building = false;
  }, 300);
  const root = resolve(OUT);
  const server = Bun.serve({
    port: Number(process.env.PORT) || 3000,
    async fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      // clean URLs as Cloudflare Pages serves them: /datenschutz is datenschutz.html, /docs is docs/
      if (path.endsWith("/")) path += "index.html";
      else if (!/\.[a-z0-9]+$/i.test(path)) path = (await Bun.file(resolve(root, `.${path}.html`)).exists()) ? `${path}.html` : `${path}/index.html`;
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(root + sep) || !(await Bun.file(file).exists())) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(file));
    },
  });
  console.log(`serving ${OUT}/ on ${server.url}`);
}
