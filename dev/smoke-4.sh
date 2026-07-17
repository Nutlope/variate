#!/bin/bash
# smoke-4: v2 surface: drain, discard, compare, assets, ship-pack export.
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }
S() { curl -s localhost:$PORT/api/state; }
HERO='j.pages[0].sections.find(x=>x.slug==="hero")'

echo "-- drain: empty exits 2 with []"
set +e; OUT=$(node scripts/await.mjs --ws "$WS" --drain); RC=$?; set -e
test $RC = 2 && test "$OUT" = "[]"

echo "-- drain claims a batch, redelivers after crash, acks fold in"
curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"variate","target":{"slug":"hero"},"params":{"count":2}}' > /dev/null
curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"polish"}' > /dev/null
test "$(node scripts/await.mjs --ws "$WS" --drain | J 'j.length')" = "2"
test "$(node scripts/await.mjs --ws "$WS" --drain | J 'j.filter(x=>x.redelivered).length')" = "2"
set +e
node scripts/await.mjs --ws "$WS" --drain --ack 0001 --note a > /dev/null
node scripts/await.mjs --ws "$WS" --drain --ack 0002 --note b > /dev/null
set -e
test "$(ls "$WS"/requests/done/*.json | wc -l | tr -d ' ')" = "2"

echo "-- heartbeat touched by drain (presence leaves 'away')"
test "$(S | J 'j.agent.mode')" != "away"

echo "-- compare route renders picker with keep/discard"
curl -s "localhost:$PORT/compare/index/hero" | grep -q 'data-keep'
curl -s "localhost:$PORT/frame/index/hero?take=1&ctx=1" | grep -q 'opacity:.38'

echo "-- static compare file"
OUT=$(node scripts/compare.mjs --ws "$WS" --slug hero)
test -f "$OUT" && grep -q 'srcdoc=' "$OUT"

echo "-- asset upload: whitelist, slugified, served, bad ext rejected"
B64=$(printf 'fakepng' | base64)
PAYLOAD="{\"name\":\"My Logo!.png\",\"base64\":\"$B64\"}"
RESP=$(curl -s -X POST localhost:$PORT/api/asset -H 'Content-Type: application/json' -d "$PAYLOAD")
test "$(echo "$RESP" | J 'j.path')" = "assets/my-logo.png"
test -f "$WS/assets/my-logo.png"
curl -s "localhost:$PORT/assets/my-logo.png" | grep -q fakepng
BAD="{\"name\":\"evil.sh\",\"base64\":\"$B64\"}"
curl -s -X POST localhost:$PORT/api/asset -H 'Content-Type: application/json' -d "$BAD" | J 'j.error' | grep -q "only"

echo "-- take with asset img: frame rewrites path, missing asset warns"
cat > "$WS/site/sections/index/hero/take-3.html" <<'EOF'
<section data-rb="hero"><img src="assets/my-logo.png" alt="logo"><img src="assets/ghost.png" alt="gone"><h1>with images</h1></section>
EOF
node -e 'const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p));const h=m.pages[0].sections.find(s=>s.slug==="hero");h.takes.push("take-3.html");h.active=h.takes.length-1;m.rev++;fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n")' "$WS/site/manifest.json"
sleep 0.6
curl -s "localhost:$PORT/frame/index/hero" | grep -q 'src="/assets/my-logo.png"'
S | J "$HERO.warning" | grep -q "missing asset (assets/ghost.png)"
S | J "$HERO.warning" | grep -vq "outside assets"

echo "-- discard reindexes active and refuses the last take"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"discard","slug":"hero","take":0}' > /dev/null
test "$(S | J "$HERO.takes")" = "2"
test "$(S | J "$HERO.active")" = "1"
ls "$WS/site/sections/index/hero" | grep -q take-1.html

echo "-- ship-pack export: meta/OG/favicon + assets copied + relative paths kept"
curl -s -X POST localhost:$PORT/api/export -H 'Content-Type: application/json' -d '{}' > /dev/null
grep -q 'name="description"' "$WS/dist/index.html"
grep -q 'property="og:title"' "$WS/dist/index.html"
grep -q 'rel="icon"' "$WS/dist/index.html"
grep -q 'src="assets/my-logo.png"' "$WS/dist/index.html"
test -f "$WS/dist/assets/my-logo.png"
echo "-- export is idempotent (one ship block after re-export)"
curl -s -X POST localhost:$PORT/api/export -H 'Content-Type: application/json' -d '{}' > /dev/null
test "$(grep -c 'variate-ship\b' "$WS/dist/index.html" || true)" -le 3

echo "smoke-4 PASS"
