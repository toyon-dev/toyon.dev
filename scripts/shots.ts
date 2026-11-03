// Re-takes the product pictures from the Toyon running on this machine, so the page can be
// re-rendered whenever Toyon's look changes:
//
//   public/media/window.jpg   the whole window, 1400x876 at 2x
//   public/media/rail.jpg     the chat list down the side, clipped to the rail, at 2x
//
// Run scripts/avif.ts afterwards for the AVIFs the page actually serves.
//
// Run it with the Toyon you want pictured open in the state you want pictured (the worktree
// selected, its preview up, a few chats in the list):
//
//   bun scripts/shots.ts            the local daemon, signed in with ~/.toyon/token
//   bun scripts/shots.ts <url>      any shell address that carries its own #token=
//   ROW="dark mode" bun ...         select the chat whose row says that before shooting
//   WT=<id> REPO=<id> bun ...       open that worktree of that project, listed or not (the ids
//                                   are in ~/.toyon/state.json under worktrees and repos)
//
// The browser it drives is a fresh profile, so the shell opens where it opens for a new
// visitor, the first project's lead, not what your own window has selected; ROW picks the chat
// from the list, WT and REPO restore one the list may not show.
// The picture is the chat beside the app with the list of chats open: the rail is pinned, the
// composer's one-time offer to install the app is marked as already seen, and the changes panel
// is shut, twice if need be: a fresh profile opens it by itself the first time the worktree on
// screen reports a diff, which lands after the page is up.
//
// Needs Chromium at /Applications/Chromium.app (or CHROMIUM=/path/to/binary). No packages: it
// talks to the browser over the DevTools socket that Bun's WebSocket already speaks.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CHROMIUM = process.env.CHROMIUM ?? "/Applications/Chromium.app/Contents/MacOS/Chromium";
const WIDTH = 1400;
const HEIGHT = 876;
const SCALE = 2;
const ROWS = ".rail-list [data-wt]"; // one chat in the list
const RAIL = ".rail-panel";
const RAIL_OPEN = ".rail.hold, .rail.pinned"; // the list unfurled from its strip of dots
const CHANGES = ".changes-dock:not(.collapsed)"; // the dock stays in the page when shut
// localStorage the shell reads at boot (packages/shell/src/state/keys.ts)
const PRESET = { "toyon-rail": "1", "toyon-install-offered": "1" };
// the rail's own default is 280, where a long name fits beside all its counts. The picture of
// the list alone takes 288, so that its 3:2 clip (two thirds of the width tall, 192) ends on
// the sixth row's seat, six rows of 32 under the panel's top; the window picture gives it less.
const RAIL_W = { window: 220, rail: 288 };
const CHAT_W = 440; // the shell's default is 380

function shellUrl(): string {
  if (process.argv[2]) return process.argv[2];
  const tokenFile = join(process.env.TOYON_HOME ?? join(homedir(), ".toyon"), "token");
  if (!existsSync(tokenFile)) throw new Error(`no token at ${tokenFile}; is Toyon running?`);
  const token = readFileSync(tokenFile, "utf8").trim();
  const port = process.env.TOYON_PORT ?? "4141";
  return `http://toyon.localhost:${port}/#token=${token}`;
}

/** A DevTools session on one page: send a command, get its result. */
class Page {
  private id = 0;
  private waiting = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
  constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      const w = m.id !== undefined ? this.waiting.get(m.id) : undefined;
      if (!w) return;
      this.waiting.delete(m.id);
      m.error ? w.no(new Error(m.error.message)) : w.ok(m.result);
    };
  }
  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, no) => this.waiting.set(id, { ok, no }));
  }
  async eval(expression: string): Promise<any> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    return r.result.value;
  }
  /** polls until the page's expression is truthy, up to a deadline */
  async until(expression: string, what: string, ms = 20000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.eval(expression)) return;
      await Bun.sleep(200);
    }
    throw new Error(`gave up waiting for ${what}`);
  }
  /** presses one key with modifiers (CDP's bitmask: alt 1, ctrl 2, command 4, shift 8) */
  async key(key: string, code: number, modifiers: number) {
    for (const type of ["keyDown", "keyUp"]) {
      await this.send("Input.dispatchKeyEvent", {
        type,
        key,
        code: `Key${key.toUpperCase()}`,
        windowsVirtualKeyCode: code,
        modifiers,
      });
    }
  }
  async shot(file: string, clip?: { x: number; y: number; width: number; height: number }) {
    const r = await this.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 88,
      // the clip is in CSS px; the device scale factor already makes the capture 2x
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    });
    await Bun.write(file, Buffer.from(r.data, "base64"));
    console.log(`wrote ${file}`);
  }
}

async function main() {
  const url = shellUrl();
  mkdirSync("public/media", { recursive: true });
  const profile = join(tmpdir(), `toyon-shots-${process.pid}`);

  const chromium = Bun.spawn(
    [
      CHROMIUM,
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      `--force-device-scale-factor=${SCALE}`,
      "--hide-scrollbars",
      "--no-first-run",
      "about:blank",
    ],
    { stderr: "pipe", stdout: "ignore" },
  );
  try {
    // Chromium prints the socket it listens on once it is up.
    let log = "";
    const reader = chromium.stderr.getReader();
    const decoder = new TextDecoder();
    while (!/DevTools listening on (ws:\S+)/.test(log)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`Chromium exited before listening:\n${log}`);
      log += decoder.decode(value);
    }
    const browserWs = /DevTools listening on (ws:\S+)/.exec(log)![1];
    const http = browserWs.replace(/^ws:\/\/([^/]+)\/.*$/, "http://$1");
    const target = (await (await fetch(`${http}/json/list`)).json()).find((t: any) => t.type === "page");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => {
      ws.onopen = ok;
      ws.onerror = () => no(new Error("could not reach the page's DevTools socket"));
    });
    const page = new Page(ws);

    await page.send("Page.enable");
    await page.send("Runtime.enable");
    // --window-size counts the browser frame; this sets the viewport itself.
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });

    /** Shuts the changes panel if it is up. Its chord (command B) closes it, after first bringing
     * its own tab forward when another tab was showing, so up to two presses. */
    const shutChanges = async () => {
      for (let press = 0; press < 2 && (await page.eval(`!!document.querySelector(${JSON.stringify(CHANGES)})`)); press++) {
        await page.key("b", 66, 4);
        await Bun.sleep(400);
      }
      await page.until(`!document.querySelector(${JSON.stringify(CHANGES)})`, "the changes panel to close", 5000);
      // a chord also focuses what it touched, and a focus ring is not part of the picture
      await page.eval("document.activeElement?.blur()");
    };

    // WT and REPO are the ids the shell restores a reload to, for a chat the list does not show
    const restore = {
      ...(process.env.WT ? { "toyon-active": process.env.WT } : {}),
      ...(process.env.REPO ? { "toyon-repo": process.env.REPO } : {}),
    };
    /** Opens the shell with the given widths and brings it to the pictured state: the chat WT or
     * ROW names selected, the changes panel shut, the rail pinned, nothing focused. The widths are
     * read once at boot, so each picture that wants its own is a load of its own. */
    let preset: string | undefined;
    const load = async (widths: Record<string, string>) => {
      if (preset) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: preset });
      // runs before the shell's own script on the new document, so the shell boots with these set
      const r = await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: [
          ...Object.entries({ ...PRESET, ...restore, ...widths }).map(
            ([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`,
          ),
          // the bar's "install app" chip is up whenever Chromium offers to install the page, which a
          // browser tab always is; the picture is of Toyon as the installed app, which has no chip.
          // Capture listeners on a target run before its others, so this one eats the offer first.
          `window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);`,
        ].join("\n"),
      });
      preset = r.identifier;
      // the shell's address differs from itself only past the #, and a navigation that changes
      // only the fragment keeps the document; a step through about:blank makes it a new one
      await page.send("Page.navigate", { url: "about:blank" });
      await page.until(`location.href === "about:blank"`, "the blank page", 5000);
      await page.send("Page.navigate", { url });
      try {
        await page.until(`document.querySelectorAll(${JSON.stringify(ROWS)}).length > 0`, "the chat list");
        if (process.env.ROW) {
          const hit = await page.eval(
            `(() => { const want = ${JSON.stringify(process.env.ROW.toLowerCase())};
              const row = [...document.querySelectorAll(${JSON.stringify(ROWS)})]
                .find((r) => r.textContent.toLowerCase().includes(want));
              if (row) row.click(); return !!row; })()`,
          );
          if (!hit) throw new Error(`no chat in the list says ${JSON.stringify(process.env.ROW)}`);
        }
        await page.until(`!!document.querySelector("iframe")`, "the preview", 30000);
        // selecting a chat hands the keyboard to the composer, which keeps some chords for itself
        await page.eval("document.activeElement?.blur()");
        await shutChanges();
        // at rest the rail is a strip of dots; the preset pins it open, and the chord (command
        // shift K) is the fallback. A synthetic hover would not do, since the shell gates hover
        // on a real pointer.
        if (!(await page.eval(`!!document.querySelector(${JSON.stringify(RAIL_OPEN)})`))) {
          await page.key("K", 75, 12);
          await page.until(`!!document.querySelector(${JSON.stringify(RAIL_OPEN)})`, "the rail to open", 5000);
        }
        await page.eval("document.activeElement?.blur()");
        // Fonts, the preview's own page, and the rail's slide-in all settle in a moment. So does
        // the worktree's first git status, which opens the changes panel once on a fresh profile.
        await Bun.sleep(3000);
        await shutChanges();
        await Bun.sleep(500);
      } catch (e) {
        // say what the page showed instead, and keep a picture of it
        const seen = join(tmpdir(), "toyon-shots-failed.jpg");
        await page.shot(seen);
        const text = await page.eval("document.body.innerText.slice(0, 400)");
        throw new Error(`${(e as Error).message}; the page said: ${JSON.stringify(text)} (picture at ${seen})`);
      }
    };

    // the window: a slim list, a roomy chat, the app with the rest
    await load({ "toyon-rail-w": String(RAIL_W.window), "toyon-chat-w": String(CHAT_W) });
    await page.shot("public/media/window.jpg");

    // the list on its own, at the width every name and count fits
    await load({ "toyon-rail-w": String(RAIL_W.rail) });
    const rail = await page.eval(
      `(() => { const r = document.querySelector(${JSON.stringify(RAIL)})?.getBoundingClientRect();
        return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    if (!rail || rail.width === 0) throw new Error(`no ${RAIL} on the page; the rail may be collapsed at this width`);
    // the top of the list at the step pictures' 3:2, not the whole column of empty ground
    await page.shot("public/media/rail.jpg", { ...rail, height: Math.min(rail.height, (rail.width * 2) / 3) });

    ws.close();
  } finally {
    chromium.kill();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
