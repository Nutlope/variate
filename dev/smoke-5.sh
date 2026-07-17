#!/bin/bash
# smoke-5: multi-page: v1 -> v2 migration idempotence, per-page ops and
# routes, the "page" request, flat multi-page export with cross-page links.
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))
J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }
S() { curl -s localhost:$PORT/api/state; }

echo "-- fixture starts v1 (flat sections, no pages)"
grep -q '"sections"' "$WS/site/manifest.json"
test ! -d "$WS/site/sections/index"

node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

echo "-- boot migrated the disk + manifest to v2"
grep -q '"pages"' "$WS/site/manifest.json"
test -d "$WS/site/sections/index/hero"
test ! -d "$WS/site/sections/hero"
grep -q "migrated the workspace" "$WS/state/journal.jsonl"

echo "-- migration is idempotent across restarts"
kill $SRV; sleep 0.4
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
sleep 1
test "$(grep -c 'migrated the workspace' "$WS/state/journal.jsonl")" = "1"
test "$(S | J 'j.pages[0].sections.length')" = "3"

echo "-- a 'page' request queues with params and no slug target"
ID=$(curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"page","params":{"id":"about","title":"About"}}' | J 'j.id')
OUT=$(node scripts/await.mjs --ws "$WS" --drain)
echo "$OUT" | grep -q '"type":"page"'

echo "-- agent lands the about page (simulated): tabs appear in state"
node -e '
const fs = require("fs");
const p = process.argv[1];
const m = JSON.parse(fs.readFileSync(p));
m.pages.push({ id: "about", title: "About", route: "about.html", sections: [] });
m.rev++;
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$WS/site/manifest.json"
mkdir -p "$WS/site/sections/about/hero"
printf '<section data-rb="hero"><h1>About Loam</h1><p>Our story, told briefly and honestly for this smoke test of pages.</p><a href="index.html">home</a></section>' > "$WS/site/sections/about/hero/take-1.html"
node -e '
const fs = require("fs");
const p = process.argv[1];
const m = JSON.parse(fs.readFileSync(p));
m.pages.find((x) => x.id === "about").sections.push({ slug: "hero", takes: ["take-1.html"], active: 0 });
m.rev++;
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$WS/site/manifest.json"
set +e; node scripts/await.mjs --ws "$WS" --drain --ack "$ID" --note "drafted about" > /dev/null 2>&1; set -e
sleep 0.6
test "$(S | J 'j.pages.map(x=>x.id).join(",")')" = "index,about"

echo "-- per-page routes + ops stay scoped"
curl -s localhost:$PORT/frame/about/hero | grep -q "About Loam"
curl -s "localhost:$PORT/compare/about/hero" | grep -q 'class="picker"'
curl -s "localhost:$PORT/page?p=about" | grep -q "About Loam"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"pick","page":"about","slug":"hero","take":0}' | J 'j.ok' | grep -q true
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"cut","page":"about","slug":"nope"}' | J 'j.error' | grep -q 'on about'

echo "-- live /page rewrites flat links to /page?p= routes"
curl -s "localhost:$PORT/page?p=about" | grep -q 'href="/page?p=index"'

echo "-- flat export: index.html + about.html, both ship-packed"
curl -s -X POST localhost:$PORT/api/export -H 'Content-Type: application/json' -d '{}' > /dev/null
test -f "$WS/dist/index.html" && test -f "$WS/dist/about.html"
grep -q 'property="og:title"' "$WS/dist/about.html"
grep -q 'href="index.html"' "$WS/dist/about.html"

echo "-- static compare handles --page"
OUT=$(node scripts/compare.mjs --ws "$WS" --slug hero --page about)
grep -q "About Loam" "$OUT"

echo "smoke-5 PASS"
