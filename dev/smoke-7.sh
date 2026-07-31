#!/bin/bash
# smoke-7: the done-ack re-export (dist always reflects the final state, even
# when the verdict lands in the same turn as the ack) and await.mjs --peek /
# --peek --hook (count without claiming, warn without blocking).
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))

J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }
S() { curl -s localhost:$PORT/api/state; }

echo "-- peek before any workspace state: idle, exit 2, zero side effects"
set +e
OUT=$(node scripts/await.mjs --ws "$WS" --peek)
RC=$?
set -e
test $RC = 2
test "$(echo "$OUT" | J 'j.queued')" = "0"
test "$(echo "$OUT" | J 'j.working')" = "0"
test ! -f "$WS/state/agent.heartbeat"

node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

echo "-- the done click exports eagerly (take-1 is active)"
ID=$(curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"done"}' | J 'j.id')
sleep 0.3
test -f "$WS/dist/index.html"
grep -q 'Know your soil' "$WS/dist/index.html"

echo "-- peek sees the queued done without claiming it, exit 0, no heartbeat"
set +e
OUT=$(node scripts/await.mjs --ws "$WS" --peek)
RC=$?
set -e
test $RC = 0
test "$(echo "$OUT" | J 'j.queued')" = "1"
test "$(echo "$OUT" | J 'j.working')" = "0"
echo "$OUT" | grep -q '"done"'
test "$(ls "$WS/requests" | grep -c '\.working$')" = "0"
test ! -f "$WS/state/agent.heartbeat"

echo "-- peek --hook emits a systemMessage and exits 0"
OUT=$(node scripts/await.mjs --ws "$WS" --peek --hook)
test $? = 0
echo "$OUT" | grep -q 'systemMessage'
echo "$OUT" | grep -q 'done'

echo "-- claim, flip the active take, ack: dist re-exports to the final state"
node scripts/await.mjs --ws "$WS" --drain > /dev/null
curl -s -X POST localhost:$PORT/api/op -H 'Content-Type: application/json' -d '{"op":"pick","slug":"hero","take":1}' > /dev/null
set +e
node scripts/await.mjs --ws "$WS" --drain --ack "$ID" --note "wrapped up" > /dev/null
set -e
sleep 1
grep -q 'Healthy crops start twelve inches down' "$WS/dist/index.html"
! grep -q 'Know your soil' "$WS/dist/index.html"
test "$(grep -c '"op":"export"' "$WS/state/journal.jsonl")" = "2"

echo "-- peek counts an orphaned claim as working"
curl -s -X POST localhost:$PORT/api/request -H 'Content-Type: application/json' -d '{"type":"instruct","target":{"page":"index","slug":"hero"},"params":{"instruction":"x"}}' > /dev/null
node scripts/await.mjs --ws "$WS" --drain > /dev/null
set +e
OUT=$(node scripts/await.mjs --ws "$WS" --peek)
RC=$?
set -e
test $RC = 0
test "$(echo "$OUT" | J 'j.working')" = "1"
test "$(echo "$OUT" | J 'j.queued')" = "0"
node scripts/await.mjs --ws "$WS" --peek --hook | grep -q 'claimed but unfinished'

echo "-- a restart does not re-export historical acks"
kill $SRV
sleep 0.4
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
sleep 1.2
test "$(grep -c '"op":"export"' "$WS/state/journal.jsonl")" = "2"

echo "-- after the last ack the hook goes quiet"
IID=$(ls "$WS/requests" | grep '\.working$' | sed 's/^\([0-9]*\)-.*/\1/')
set +e
node scripts/await.mjs --ws "$WS" --drain --ack "$IID" --note "landed" > /dev/null
set -e
OUT=$(node scripts/await.mjs --ws "$WS" --peek --hook)
test $? = 0
test -z "$OUT"

echo "smoke-7 PASS"
