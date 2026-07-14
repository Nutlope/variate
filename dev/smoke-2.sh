#!/bin/bash
# M2: deterministic ops + journal + undo/redo, including across a restart.
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }

echo "-- move hero down: order becomes nav,features,hero"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"move","slug":"hero","dir":"down"}' > /dev/null
test "$(curl -s localhost:$PORT/api/state | J 'j.sections.map(x=>x.slug).join(",")')" = "nav,features,hero"

echo "-- pick hero take 2"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"pick","slug":"hero","take":1}' > /dev/null
test "$(curl -s localhost:$PORT/api/state | J 'j.sections.find(x=>x.slug==="hero").active')" = "1"

echo "-- cut features: gone from manifest, file still on disk"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"cut","slug":"features"}' > /dev/null
test "$(curl -s localhost:$PORT/api/state | J 'j.sections.length')" = "2"
test -f "$WS/site/sections/features/take-1.html"

echo "-- undo restores features"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"undo"}' > /dev/null
test "$(curl -s localhost:$PORT/api/state | J 'j.sections.length')" = "3"

echo "-- redo cuts it again, undo brings it back"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"redo"}' > /dev/null
test "$(curl -s localhost:$PORT/api/state | J 'j.sections.length')" = "2"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"undo"}' > /dev/null

echo "-- journal has full manifest snapshots"
tail -1 "$WS/state/journal.jsonl" | grep -q '"manifest"'

echo "-- undo survives a server restart"
kill $SRV; sleep 0.4
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
sleep 1
test "$(curl -s localhost:$PORT/api/state | J 'j.canUndo')" = "true"
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"undo"}' > /dev/null
test "$(curl -s localhost:$PORT/api/state | J 'j.sections.map(x=>x.slug).join(",")')" = "nav,features,hero"

echo "M2 PASS"
