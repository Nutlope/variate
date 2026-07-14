#!/usr/bin/env node
// A canned "agent" for developing the studio without an LLM: it loops on
// await.mjs, fulfills every request with a labeled placeholder take, and acks.
//
//   node fixtures/pseudo-agent.mjs --ws <workspace> [--delay 1200]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
if (!args.ws) { console.error("--ws required"); process.exit(1); }

const WS = path.resolve(args.ws);
const DELAY = Number(args.delay ?? 1200);
const AWAIT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "await.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = () => JSON.parse(fs.readFileSync(path.join(WS, "site", "manifest.json"), "utf8"));
const saveManifest = (m) => {
  m.rev = (m.rev ?? 0) + 1;
  fs.writeFileSync(path.join(WS, "site", "manifest.json"), JSON.stringify(m, null, 2) + "\n");
};

function takeDoc(slug, label, tone) {
  return `<section data-rb="${slug}" style="background:${tone};border:1px dashed #b7ab8e;padding:64px 24px;text-align:center">
  <h2 style="font-size:26px;margin-bottom:8px">${slug}: ${label}</h2>
  <p style="color:#5d564a">canned take from the pseudo-agent</p>
</section>\n`;
}

function nextTakeFile(slug) {
  const dir = path.join(WS, "site", "sections", slug);
  fs.mkdirSync(dir, { recursive: true });
  const ns = fs.readdirSync(dir).map((f) => Number(f.match(/take-(\d+)\.html/)?.[1] ?? 0));
  return { dir, n: Math.max(0, ...ns) + 1 };
}

function writeTake(slug, label, activate = true) {
  const { dir, n } = nextTakeFile(slug);
  const tones = ["#fdf6e3", "#eef4ee", "#f0ecfa", "#fbeee6"];
  fs.writeFileSync(path.join(dir, `take-${n}.html`), takeDoc(slug, label, tones[n % 4]));
  const m = manifest();
  let sec = m.sections.find((s) => s.slug === slug);
  if (!sec) { sec = { slug, takes: [], active: 0 }; m.sections.push(sec); }
  sec.takes.push(`take-${n}.html`);
  if (activate) sec.active = sec.takes.length - 1;
  saveManifest(m);
}

function uniqueSlug(base) {
  const taken = new Set(manifest().sections.map((s) => s.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

let ackArgs = [];
console.log("pseudo-agent looping; ctrl-c to stop");
for (;;) {
  let out;
  try {
    out = execFileSync(process.execPath, [AWAIT, "--ws", WS, "--timeout", "50", ...ackArgs], { encoding: "utf8" });
  } catch (e) {
    if (e.status === 2) { ackArgs = []; continue; } // idle
    console.error(e.stdout ?? "", e.stderr ?? "");
    process.exit(1);
  }
  ackArgs = [];
  const req = JSON.parse(out.trim());
  console.log("request:", req.id, req.type, req.target?.slug ?? "", req.params?.steer ?? "");
  await sleep(DELAY);

  if (req.type === "variate") {
    const n = Math.max(1, Math.min(4, Number(req.params?.count ?? 1)));
    for (let i = 0; i < n; i++) {
      writeTake(req.target.slug, `${req.params?.steer ?? "fresh"} take ${i + 1}`, i === 0);
      await sleep(500); // let takes land one by one, like a real agent
    }
    ackArgs = ["--ack", req.id, "--note", `drew ${n} canned take${n > 1 ? "s" : ""}`];
  } else if (req.type === "instruct") {
    writeTake(req.target.slug, `edited: ${String(req.params?.instruction ?? "").slice(0, 40)}`);
    ackArgs = ["--ack", req.id, "--note", "applied the edit as a new take"];
  } else if (req.type === "sketch") {
    writeTake(req.target.slug, "from your sketch");
    ackArgs = ["--ack", req.id, "--note", `read a ${(req.params?.blueprint ?? "").length}-char blueprint${req.params?.png ? " + png" : ""}`];
  } else if (req.type === "add") {
    const slug = uniqueSlug(req.params?.kind ?? "custom");
    const m = manifest();
    const pos = req.params?.position ?? "end";
    let at = m.sections.length;
    if (pos === "start") at = 0;
    else if (pos.startsWith("after:")) {
      const i = m.sections.findIndex((s) => s.slug === pos.slice(6));
      at = i === -1 ? m.sections.length : i + 1;
    }
    m.sections.splice(at, 0, { slug, takes: [], active: 0 });
    saveManifest(m);
    writeTake(slug, `new ${req.params?.kind ?? "section"}`);
    ackArgs = ["--ack", req.id, "--note", `added ${slug}`];
  } else if (req.type === "polish") {
    ackArgs = ["--ack", req.id, "--note", "polished (canned no-op)"];
  } else if (req.type === "done") {
    try {
      execFileSync(process.execPath, [AWAIT, "--ws", WS, "--timeout", "2", "--ack", req.id, "--note", "wrapped up"], { encoding: "utf8" });
    } catch { /* exit 2 after the ack is expected: queue is empty */ }
    console.log("done; exiting");
    process.exit(0);
  } else if (req.type === "idle") {
    continue;
  }
}
