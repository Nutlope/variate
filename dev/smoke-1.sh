#!/bin/bash
# M1: server read path against a copy of the fixture workspace.
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

echo "-- state: three sections"
test "$(curl -s localhost:$PORT/api/state | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).sections.length))')" = "3"

echo "-- frame/hero: forced data-rb + height reporter present"
FRAME=$(curl -s localhost:$PORT/frame/hero)
echo "$FRAME" | grep -q 'data-rb="hero"'
echo "$FRAME" | grep -q "rb-h"
echo "$FRAME" | grep -q "IntersectionObserver"

echo "-- frame CSP header"
curl -s -D - -o /dev/null localhost:$PORT/frame/hero | grep -qi "content-security-policy"

echo "-- /page assembles all three sections in order"
PAGE=$(curl -s localhost:$PORT/page)
echo "$PAGE" | grep -q 'data-rb="nav"'
echo "$PAGE" | grep -q 'data-rb="hero"'
echo "$PAGE" | grep -q 'data-rb="features"'

echo "-- SSE: touching a take broadcasts a state event"
(curl -sN --max-time 4 localhost:$PORT/events > /tmp/variate-sse.txt) & SSE=$!
sleep 0.5
touch "$WS/site/sections/hero/take-1.html"
wait $SSE 2>/dev/null || true
COUNT=$(grep -c "^event: state" /tmp/variate-sse.txt)
test "$COUNT" -ge 2   # initial + broadcast

echo "-- host header guard"
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' localhost:$PORT/api/state)" = "403"

echo "M1 PASS"
