#!/usr/bin/env node
// The variate sidecar. Zero dependencies, binds 127.0.0.1 only.
//
// It does not render anything and it does not proxy the user's dev server.
// It serves the card, answers what the sets look like, and performs switches.
// State is derived from disk on a 1s tick and pushed over SSE only when it
// actually changed, so there is no file watcher to get wrong per platform.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  paths, listSets, setSummary, switchTo, readSet, atomicWrite, readSafe,
  readBytes, statMtimeSafe, defaultPortFor, nowIso, VERSION,
} from "./core.mjs";
import { createRequest, queueState, TYPES } from "./queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, "..", "client");
export { VERSION };

// ---------------------------------------------------------------------------
// guards
//
// The threat is a web page you happen to visit reaching your localhost and
// making variate write files, kill the card, or queue an ask whose text your
// agent will read as if you had typed it.
//
// The token is NOT a secret from a page that can run a script tag: /v.js is a
// classic script that declares `const VARIATE = {...}` in the global lexical
// scope, so any page that includes it can read the token, and the port is one
// of 800. The token stops unaimed requests; what actually stops an aimed one
// is that mutating a thing requires BOTH a loopback Host and an Origin that
// is either absent (a non-browser client, which is the CLI) or a real
// localhost dev server. A browser always sends an Origin on a POST, and an
// opaque origin (a sandboxed iframe) sends the literal "null", which is
// allowed to read but never to write.

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;                            // the CLI, or a plain GET
  if (o === "null") return req.method === "GET";  // opaque origin: never mutating
  return LOCAL_ORIGIN.test(o);
}

function corsHeaders(req) {
  const o = req.headers.origin;
  if (o && LOCAL_ORIGIN.test(o)) {
    return {
      "Access-Control-Allow-Origin": o,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      Vary: "Origin",
    };
  }
  return { Vary: "Origin" };
}

// ---------------------------------------------------------------------------

// Serving the project itself, for a page that has no dev server of its own
// (a plain HTML site, or one variate just scaffolded). This is not a studio:
// it serves the user's real files, unmodified, at the same origin as the card,
// which also means the card's own calls are same-origin and CORS never enters
// the picture. Any project with a real dev server is never served from here.
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

// When variate serves the page, the tag is injected here rather than written
// into the file. That keeps the user's HTML free of variate entirely, which
// matters most when the page IS the file being varied: a variant is a whole
// file replacement, so a tag stored in it would vanish on the first switch.
function withCard(html) {
  const tag = '<script src="/v.js"></script>';
  if (html.includes('src="/v.js"')) return html;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + "\n" + tag + "\n" : html.slice(0, i) + tag + "\n" + html.slice(i);
}

const HOLDING = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waiting for the first design</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:#f7f5f1;color:#1a1815;
    font:400 15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
  p{opacity:.55;letter-spacing:.02em}
</style></head>
<body><p>drafting</p></body></html>
`;

const REAL_ROOTS = new Map();
function realRootFor(root) {
  let r = REAL_ROOTS.get(root);
  if (!r) { r = fs.realpathSync(root); REAL_ROOTS.set(root, r); }
  return r;
}

function serveStatic(root, urlPath, res, send) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith("/")) rel += "index.html";
  // No dotfiles, ever: /.variate holds the token, and /.env or /.git are
  // exactly what a drive-by localhost probe hopes for. This also refuses
  // /.well-known, which a design sidecar has no business serving.
  if (rel.split("/").some((s) => s.startsWith("."))) return send(res, 403, "no");
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "no");
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html"); } catch { /* below */ }
  // The entry page can be legitimately absent for a moment: a set drafted
  // from nothing has no file until its first switch. Hold the URL open with
  // the card on it rather than showing a 404 that reads as broken.
  if (!fs.existsSync(target) && path.resolve(target) === path.join(root, "index.html")) {
    return send(res, 200, withCard(HOLDING), { "Content-Type": STATIC_MIME[".html"] });
  }
  if (!fs.existsSync(target)) return send(res, 404, "not found");
  // The lexical check above cannot see through links: a symlink inside the
  // project (node_modules, an uploads folder) may point anywhere on disk.
  // Resolve both sides for real before reading; the root gets the same
  // treatment because /tmp itself is a link on macOS.
  let real;
  try { real = fs.realpathSync(target); } catch { return send(res, 404, "not found"); }
  const rootReal = realRootFor(root);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return send(res, 403, "no");
  const ext = path.extname(target).toLowerCase();
  const type = STATIC_MIME[ext] ?? "application/octet-stream";
  if (ext === ".html" || ext === ".htm") {
    return send(res, 200, withCard(fs.readFileSync(target, "utf8")), { "Content-Type": type });
  }
  return send(res, 200, fs.readFileSync(target), { "Content-Type": type });
}

export function startSidecar({ root, port, serve = false }) {
  const P = paths(root);
  fs.mkdirSync(P.REQ_DONE, { recursive: true });
  fs.mkdirSync(path.dirname(P.HEARTBEAT), { recursive: true });

  let token = readSafe(P.TOKEN)?.trim();
  if (!token || token.length < 16) {
    token = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(P.TOKEN, token + "\n", { mode: 0o600 });
  }

  const started = Date.now();
  let cardSeenAt = null;   // last GET /v.js: proof the script tag works
  const clients = new Set();
  let lastJson = "";

  // The query token exists for EventSource alone, which cannot set headers.
  // Every other caller sends the Authorization header (the card and the CLI),
  // and a cross-origin no-cors POST cannot set one, so keeping ?t= to GET
  // takes the whole mutating surface away from a page that stole the token.
  const authed = (req, url) =>
    (req.headers.authorization === `Bearer ${token}`) ||
    (req.method === "GET" && url.searchParams.get("t") === token);

  function computeState() {
    const sets = listSets(P).map(setSummary);
    const q = queueState(P);
    const hb = statMtimeSafe(P.HEARTBEAT);
    const hbAge = hb == null ? Infinity : Date.now() - hb;
    return {
      ok: true,
      version: VERSION,
      root: P.ROOT,
      sets,
      queued: q.queued,
      working: q.working,
      // "the agent is listening" is only claimed when a drain beat recently.
      agent: hbAge < 300000 ? "here" : "away",
      at: nowIso(),
    };
  }

  function broadcast(force = false) {
    const state = computeState();
    const json = JSON.stringify(state);
    if (!force && json === lastJson) return state;
    lastJson = json;
    const frame = `event: state\ndata: ${json}\n\n`;
    for (const res of clients) { try { res.write(frame); } catch { clients.delete(res); } }
    return state;
  }

  const tick = setInterval(() => broadcast(), 1000);
  const ping = setInterval(() => {
    for (const res of clients) { try { res.write("event: ping\ndata: {}\n\n"); } catch { clients.delete(res); } }
  }, 25000);
  tick.unref?.();
  ping.unref?.();

  // The card: one file, no build step. The header carries the address and the
  // token, so the card never has to discover anything.
  //
  // It must be the port we ACTUALLY bound, not the one we asked for. When the
  // requested port is taken we retry upwards, and baking the requested number
  // into the card sends it knocking on someone else's door with our token:
  // every call 401s, no state ever arrives, and the card hides itself. The
  // user is left looking at one design with no bar and nothing to explain it.
  let boundPort = port ?? null;
  function cardSource() {
    const body = readSafe(path.join(CLIENT, "card.js")) ?? "/* card missing */";
    const header =
      `/* variate ${VERSION} card. Served by the sidecar; not a file in your repo. */\n` +
      `const VARIATE = ${JSON.stringify({ port: boundPort, token, version: VERSION })};\n`;
    return header + body;
  }

  function send(res, code, body, headers = {}) {
    res.writeHead(code, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
    res.end(body);
  }
  const sendJson = (res, code, obj, extra = {}) =>
    send(res, code, JSON.stringify(obj), { "Content-Type": "application/json", ...extra });

  async function readBody(req) {
    let buf = "";
    for await (const chunk of req) {
      buf += chunk;
      if (buf.length > 1_000_000) throw new Error("body too large");
    }
    return buf ? JSON.parse(buf) : {};
  }

  const server = http.createServer(async (req, res) => {
    const cors = corsHeaders(req);
    try {
      if (!LOOPBACK_HOST.test(req.headers.host ?? "")) return send(res, 403, "local only");
      if (!originOk(req)) return send(res, 403, "bad origin", cors);
      const url = new URL(req.url, "http://127.0.0.1");
      const p = url.pathname;

      if (req.method === "OPTIONS") return send(res, 204, "", cors);

      if (req.method === "GET") {
        if (p === "/health") {
          return sendJson(res, 200, { ok: true, root: P.ROOT, version: VERSION, startedAt: started }, cors);
        }
        if (p === "/v.js") {
          cardSeenAt = Date.now();
          return send(res, 200, cardSource(), { "Content-Type": "text/javascript; charset=utf-8", ...cors });
        }
        if (p === "/inter.woff2") {
          // The card's typeface. Not a secret (like /v.js), and the FontFace
          // load may come from the user's own dev-server origin, so it needs
          // the CORS echo. Cacheable: the card busts with ?v=<version>.
          const woff = readBytes(path.join(CLIENT, "inter", "inter.woff2"));
          if (!woff) return send(res, 404, "not found", cors);
          return send(res, 200, woff, {
            "Content-Type": "font/woff2",
            "Cache-Control": "public, max-age=604800, immutable",
            ...cors,
          });
        }
        if (p === "/state") {
          if (!authed(req, url)) return sendJson(res, 401, { error: "bad token" }, cors);
          return sendJson(res, 200, computeState(), cors);
        }
        if (p === "/events") {
          if (!authed(req, url)) return sendJson(res, 401, { error: "bad token" }, cors);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            Connection: "keep-alive",
            ...cors,
          });
          res.write("retry: 2000\n\n");
          res.write(`event: state\ndata: ${JSON.stringify(computeState())}\n\n`);
          clients.add(res);
          req.on("close", () => clients.delete(res));
          return;
        }
        // Anything else is the user's own page, when we are serving it.
        if (serve) return serveStatic(P.ROOT, p, res, send);
        return send(res, 404, "not found", cors);
      }

      if (req.method === "POST") {
        if (!authed(req, url)) return sendJson(res, 401, { error: "bad token" }, cors);
        const body = await readBody(req);

        if (p === "/switch") {
          const out = switchTo(P, String(body.set ?? ""), Number(body.to), { force: !!body.force });
          if (!out.error) {
            // The breadcrumb lets the agent's await tell "the user is flipping
            // right now" from "the round has gone quiet".
            atomicWrite(P.LAST_SWITCH, JSON.stringify({
              at: nowIso(), set: String(body.set ?? ""), to: Number(body.to),
              source: String(body.source ?? "unknown"),
            }) + "\n");
          }
          broadcast(true);
          return sendJson(res, out.error ? 400 : 200, out, cors);
        }
        if (p === "/request") {
          const type = String(body.type ?? "");
          if (!TYPES.has(type)) return sendJson(res, 400, { error: `unknown request type "${type}"` }, cors);
          const out = createRequest(P, type, body.params ?? {});
          broadcast(true);
          return sendJson(res, out.error ? 400 : 200, out, cors);
        }
        if (p === "/shutdown") {
          // `variate end` calls this after removing the sets, so the card
          // hears the empty state over SSE and bows out before the server
          // goes. A plain SIGTERM would cut the stream mid-goodbye.
          broadcast(true);
          // ...and then say goodbye for real, so the card closes its stream
          // instead of retrying a port that is never coming back.
          for (const c of clients) { try { c.write("event: bye\ndata: {}\n\n"); } catch { /* gone */ } }
          sendJson(res, 200, { ok: true, bye: true }, cors);
          setTimeout(() => process.exit(0), 800);
          return;
        }
        return send(res, 404, "not found", cors);
      }

      return send(res, 405, "method not allowed", cors);
    } catch (e) {
      return sendJson(res, 500, { error: String(e?.message ?? e) }, cors);
    }
  });

  return new Promise((resolve, reject) => {
    // One attempt, one pair of handlers, both removed before the next try.
    // The callback passed to server.listen() is just a "listening" listener,
    // so a failed attempt that leaves its own behind will still fire on the
    // NEXT success, reporting the port we wanted instead of the one we got.
    // That is how a project ends up with a server.json pointing somewhere the
    // server is not. The socket itself is the only trustworthy source.
    const listen = (want, left) => {
      const onError = (e) => {
        server.removeListener("listening", onListening);
        if (e.code === "EADDRINUSE" && left > 0) listen(want + 1, left - 1);
        else reject(e);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        boundPort = server.address().port;
        atomicWrite(P.SERVER_JSON, JSON.stringify({ pid: process.pid, port: boundPort, root: P.ROOT, startedAt: started, version: VERSION, serve }, null, 2) + "\n");
        resolve({
          port: boundPort, token, server,
          state: computeState,
          cardSeenAt: () => cardSeenAt,
          close: () => { clearInterval(tick); clearInterval(ping); server.close(); },
        });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(want, "127.0.0.1");
    };
    listen(port ?? defaultPortFor(P.ROOT), 9);
  });
}

// Run directly: node src/sidecar.mjs --root . [--port N] [--serve]
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    a[argv[i].slice(2)] = next == null || next.startsWith("--") ? true : argv[++i];
  }
  const out = await startSidecar({
    root: a.root && a.root !== true ? a.root : ".",
    port: a.port && a.port !== true ? Number(a.port) : undefined,
    serve: !!a.serve,
  });
  console.log(`variate sidecar on http://127.0.0.1:${out.port}`);
}
