#!/bin/bash
# M3: queue lifecycle: request -> claim -> ack -> done; idle; redelivery; races.
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }

echo "-- queue a variate request (target gains the default page)"
ID=$(curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"variate","target":{"slug":"hero"},"params":{"count":2,"steer":"bolder"}}' | J 'j.id')
test -f "$WS/requests/$ID-variate-hero.json"
grep -q '"page": "index"' "$WS/requests/$ID-variate-hero.json"

echo "-- await claims it (exit 0), file becomes .working"
OUT=$(node scripts/await.mjs --ws "$WS" --timeout 5); RC=$?
test $RC = 0
echo "$OUT" | grep -q '"type":"variate"'
echo "$OUT" | grep -q '"steer":"bolder"'
test -f "$WS/requests/$ID-variate-hero.json.working"

echo "-- state shows hero busy"
test "$(curl -s localhost:$PORT/api/state | J 'j.pages[0].sections.find(x=>x.slug==="hero").busy?.type ?? "none"')" = "variate"

echo "-- orphaned claim redelivers with redelivered:true"
OUT2=$(node scripts/await.mjs --ws "$WS" --timeout 5)
echo "$OUT2" | grep -q '"redelivered":true'

echo "-- ack folds into next await; empty queue exits 2 with idle"
set +e
OUT3=$(node scripts/await.mjs --ws "$WS" --ack "$ID" --result ok --note "drew 2 takes" --timeout 3); RC3=$?
set -e
test $RC3 = 2
echo "$OUT3" | grep -q '"type":"idle"'
test -f "$WS/requests/done/$ID-variate-hero.json"
grep -q '"note": "drew 2 takes"' "$WS/requests/done/$ID-variate-hero.json"

echo "-- heartbeat was touched while blocked"
test -f "$WS/state/agent.heartbeat"

echo "-- two concurrent awaits claim two distinct requests"
curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"instruct","target":{"slug":"nav"},"params":{"instruction":"make it sticky"}}' > /dev/null
curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"polish"}' > /dev/null
A=$(node scripts/await.mjs --ws "$WS" --timeout 5 & node scripts/await.mjs --ws "$WS" --timeout 5 & wait)
test "$(echo "$A" | grep -c '"id"')" = "2"
test "$(echo "$A" | sort -u | wc -l | tr -d ' ')" = "2"

echo "-- done request eagerly writes the export"
curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"done"}' > /dev/null
test -f "$WS/dist/index.html"
grep -q 'data-rb="hero"' "$WS/dist/index.html"

echo "M3 PASS"
