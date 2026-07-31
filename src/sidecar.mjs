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
  statMtimeSafe, defaultPortFor, nowIso,
} from "./core.mjs";
import { createRequest, queueState, TYPES } from "./queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, "..", "client");
export const VERSION = "3.0.0";

// ---------------------------------------------------------------------------
// guards
//
// The threat is a web page you happen to visit fetching your localhost and
// making variate write files. Three layers: the Host header must be loopback,
// the Origin (which browsers always send cross-origin) must be a localhost
// dev server, and mutating routes need the token. A hostile page cannot read
// /v.js cross-origin, so it cannot learn the token.

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function originOk(req) {
  const o = req.headers.origin;
  if (!o || o === "null") return true; // same-origin, file://, or a plain GET
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

export function startSidecar({ root, port, appUrl = null }) {
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

  const authed = (req, url) =>
    (req.headers.authorization === `Bearer ${token}`) || (url.searchParams.get("t") === token);

  function computeState() {
    const sets = listSets(P).map(setSummary);
    const q = queueState(P);
    const hb = statMtimeSafe(P.HEARTBEAT);
    const hbAge = hb == null ? Infinity : Date.now() - hb;
    return {
      ok: true,
      version: VERSION,
      root: P.ROOT,
      appUrl,
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
  function cardSource() {
    const body = readSafe(path.join(CLIENT, "card.js")) ?? "/* card missing */";
    const header =
      `/* variate ${VERSION} card. Served by the sidecar; not a file in your repo. */\n` +
      `const VARIATE = ${JSON.stringify({ port, token, version: VERSION })};\n`;
    return header + body;
  }

  function send(res, code, body, headers = {}) {
    res.writeHead(code, { "Cache-Control": "no-store", ...headers });
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
        if (p === "/state") {
          if (!authed(req, url)) return sendJson(res, 401, { error: "bad token" }, cors);
          return sendJson(res, 200, computeState(), cors);
        }
        if (p === "/events") {
          if (!authed(req, url)) return sendJson(res, 401, { error: "bad token" }, cors);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            ...cors,
          });
          res.write("retry: 2000\n\n");
          res.write(`event: state\ndata: ${JSON.stringify(computeState())}\n\n`);
          clients.add(res);
          req.on("close", () => clients.delete(res));
          return;
        }
        return send(res, 404, "not found", cors);
      }

      if (req.method === "POST") {
        if (!authed(req, url)) return sendJson(res, 401, { error: "bad token" }, cors);
        const body = await readBody(req);

        if (p === "/switch") {
          const out = switchTo(P, String(body.set ?? ""), Number(body.to));
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
        return send(res, 404, "not found", cors);
      }

      return send(res, 405, "method not allowed", cors);
    } catch (e) {
      return sendJson(res, 500, { error: String(e?.message ?? e) }, cors);
    }
  });

  return new Promise((resolve, reject) => {
    const listen = (want, left) => {
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE" && left > 0) listen(want + 1, left - 1);
        else reject(e);
      });
      server.listen(want, "127.0.0.1", () => {
        atomicWrite(P.SERVER_JSON, JSON.stringify({ pid: process.pid, port: want, root: P.ROOT, startedAt: started, version: VERSION }, null, 2) + "\n");
        resolve({
          port: want, token, server,
          state: computeState,
          cardSeenAt: () => cardSeenAt,
          close: () => { clearInterval(tick); clearInterval(ping); server.close(); },
        });
      });
    };
    listen(port ?? defaultPortFor(P.ROOT), 9);
  });
}

// Run directly: node src/sidecar.mjs --root . [--port N] [--app-url ...]
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
    appUrl: a["app-url"] && a["app-url"] !== true ? String(a["app-url"]) : null,
  });
  console.log(`variate sidecar on http://127.0.0.1:${out.port}`);
}
