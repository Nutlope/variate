#!/bin/bash
# smoke-6: land.mjs, the agent workspace CLI. Headless (fs lock) mode on a raw
# v1 fixture, server (single-writer) mode, every verb, warnings, and the
# concurrency cases in both transports.
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))

J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }
S() { curl -s localhost:$PORT/api/state; }
HERO='j.pages[0].sections.find(x=>x.slug==="hero")'

echo "-- headless land on the raw v1 fixture migrates and lands (fs mode)"
OUT=$(printf '<section data-rb="hero"><h1>headless one</h1></section>' | node scripts/land.mjs land --ws "$WS" --slug hero)
test "$(echo "$OUT" | J 'j.mode')" = "fs"
test "$(echo "$OUT" | J 'j.file')" = "take-3.html"
grep -q '"pages"' "$WS/site/manifest.json"
test -d "$WS/site/sections/index/hero"
test ! -d "$WS/site/sections/hero"
test ! -e "$WS/state/manifest.lock"
grep -q '"actor":"agent"' "$WS/state/journal.jsonl"
grep -q 'migrated the workspace' "$WS/state/journal.jsonl"

echo "-- check is a dry run: warnings out, nothing mutated"
OUT=$(printf '<!doctype html><html><body><img src="http://x/y.png"></body></html>' | node scripts/land.mjs check --ws "$WS" 2>/dev/null)
test "$(echo "$OUT" | J 'j.warnings.length >= 2')" = "true"
OUT=$(printf '<section data-rb="hero"><p>clean</p></section>' | node scripts/land.mjs check --ws "$WS" 2>/dev/null)
test "$(echo "$OUT" | J 'j.warnings.length')" = "0"
test "$(node -e "console.log(require('$WS/site/manifest.json').pages[0].sections.find(s=>s.slug==='hero').takes.length)")" = "3"

echo "-- four parallel headless lands: distinct files, all registered, lock released"
for i in 1 2 3 4; do
  printf '<section data-rb="hero"><h1>par %s</h1></section>' "$i" | node scripts/land.mjs land --ws "$WS" --slug hero --label "cc $i" &
done
wait
node -e "
const m=require('$WS/site/manifest.json');
const t=m.pages[0].sections.find(s=>s.slug==='hero').takes;
if (t.length !== 7) throw new Error('want 7 takes, got '+t.length);
if (new Set(t).size !== t.length) throw new Error('duplicate registration');
"
test "$(ls "$WS/site/sections/index/hero" | wc -l | tr -d ' ')" = "7"
test "$(grep -c '"label":"cc ' "$WS/state/journal.jsonl")" = "4"
test ! -e "$WS/state/manifest.lock"

echo "-- server boots over headless state; land routes via server, inactive by default"
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
OUT=$(printf '<section data-rb="hero"><h1>via server</h1></section>' | node scripts/land.mjs land --ws "$WS" --slug hero)
test "$(echo "$OUT" | J 'j.mode')" = "server"
test "$(S | J "$HERO.takes")" = "8"
test "$(S | J "$HERO.active")" = "0"

echo "-- no journal spam at boot: server adopted the fs-mode entries"
test "$(grep -c '"label":"cc ' "$WS/state/journal.jsonl")" = "4"

echo "-- --activate and --label land journaled with the label"
OUT=$(printf '<section data-rb="hero"><h1>warmer</h1></section>' | node scripts/land.mjs land --ws "$WS" --slug hero --activate --label "hero: warmer palette")
test "$(echo "$OUT" | J 'j.active')" = "true"
test "$(S | J "$HERO.active")" = "8"
grep -q 'warmer palette' "$WS/state/journal.jsonl"

echo "-- --create with a position splices a new section"
OUT=$(printf '<section data-rb="story"><p>story</p></section>' | node scripts/land.mjs land --ws "$WS" --slug story --create --position after:nav --activate)
test "$(echo "$OUT" | J 'j.mode')" = "server"
test "$(S | J 'j.pages[0].sections.map(x=>x.slug).join(",")')" = "nav,story,hero,features"
curl -s localhost:$PORT/frame/index/story | grep -q 'story'

echo "-- landing into a missing section without --create is refused"
set +e
printf '<section data-rb="ghost"><p>x</p></section>' | node scripts/land.mjs land --ws "$WS" --slug ghost 2>/tmp/variate-land-err.txt
RC=$?
set -e
test $RC = 1
grep -q 'no section "ghost"' /tmp/variate-land-err.txt

echo "-- warnings surface on a bad take but the land still registers"
OUT=$(printf '<section data-rb="story"><img src="http://cdn/x.png"></section>' | node scripts/land.mjs land --ws "$WS" --slug story 2>/tmp/variate-land-warn.txt)
test "$(echo "$OUT" | J 'j.ok')" = "true"
test "$(echo "$OUT" | J 'j.warnings.length >= 1')" = "true"
grep -q '^warning:' /tmp/variate-land-warn.txt

echo "-- pick addresses files (bare number and last), not indices"
node scripts/land.mjs pick --ws "$WS" --slug hero --take 3 > /dev/null
test "$(S | J "$HERO.active")" = "2"
node scripts/land.mjs pick --ws "$WS" --slug hero --take last > /dev/null
test "$(S | J "$HERO.active")" = "8"

echo "-- discard drops from the pager, file stays on disk"
node scripts/land.mjs discard --ws "$WS" --slug hero --take 4 > /dev/null
test "$(S | J "$HERO.takes")" = "8"
test -f "$WS/site/sections/index/hero/take-4.html"

echo "-- discarding a file not in the pager is refused"
set +e
node scripts/land.mjs discard --ws "$WS" --slug hero --take 4 2>/tmp/variate-land-err2.txt
RC=$?
set -e
test $RC = 1
grep -q 'is not in' /tmp/variate-land-err2.txt

echo "-- move --to start, cut, and the page verb (idempotent)"
node scripts/land.mjs move --ws "$WS" --slug features --to start > /dev/null
test "$(S | J 'j.pages[0].sections[0].slug')" = "features"
node scripts/land.mjs cut --ws "$WS" --slug story > /dev/null
test "$(S | J 'j.pages[0].sections.map(x=>x.slug).join(",")')" = "features,nav,hero"
test -d "$WS/site/sections/index/story"
OUT=$(node scripts/land.mjs page --ws "$WS" --id "About Us")
test "$(echo "$OUT" | J 'j.id')" = "about-us"
OUT=$(node scripts/land.mjs page --ws "$WS" --id about-us)
test "$(echo "$OUT" | J 'j.existed')" = "true"
OUT=$(printf '<section data-rb="hero"><h1>about</h1></section>' | node scripts/land.mjs land --ws "$WS" --page about-us --slug hero --create --activate)
test "$(echo "$OUT" | J 'j.ok')" = "true"
curl -s localhost:$PORT/frame/about-us/hero | grep -q 'about'

echo "-- five parallel server-mode lands into one section"
N0=$(ls "$WS/site/sections/index/hero" | wc -l | tr -d ' ')
PIDS=""
for i in 1 2 3 4 5; do
  printf '<section data-rb="hero"><h1>srv %s</h1></section>' "$i" | node scripts/land.mjs land --ws "$WS" --slug hero --label "srv $i" &
  PIDS="$PIDS $!"
done
wait $PIDS  # not bare wait: the studio server is a background job too
test "$(ls "$WS/site/sections/index/hero" | wc -l | tr -d ' ')" = "$((N0 + 5))"
node -e "
const m=require('$WS/site/manifest.json');
const t=m.pages[0].sections.find(s=>s.slug==='hero').takes;
if (new Set(t).size !== t.length) throw new Error('duplicate registration');
"
test "$(grep -c '"label":"srv ' "$WS/state/journal.jsonl")" = "5"

echo "-- presence reads working after agent landings"
test "$(S | J 'j.agent.mode')" = "working"

echo "-- compare picker numbers options by position, file name as tooltip"
curl -s "localhost:$PORT/compare/index/hero" | grep -q 'PAGER POSITION'

echo "smoke-6 PASS"
